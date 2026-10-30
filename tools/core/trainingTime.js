// @ts-check
/**
 * Shared Business Logic — job training, study time records (doc/brushup-2026/training-plan.ja.md
 * §4.9; D2, D3, D9–D13). Tables of server/migrations/022_training_study_time.sql. The counting is
 * the pure shared/training/studyTime.js (study-time/v1), with the school's private rules
 * (shared/training/timeRules.js) and unit list (shared/training/courseManifest.js).
 *
 * Configuration (staff, scripts/training-time.mjs): a unit list or a rules file is loaded once, as
 * an immutable version named by the sha256 of its canonical JSON (the same content again changes
 * nothing). A cohort's settings say which versions it uses from which Japan-time day: append only,
 * never from a day before today, and once one is in effect, from tomorrow at the earliest (a day
 * is counted with one setting). Nothing has a default: a day without a setting counts nothing
 * (D9). Nothing here returns or prints a rule value; the values go only to the counting.
 *
 * Closing (closeDays): a learner's days, from the first one not closed yet up to the last final one
 * (the database clock passed its end + gapMs) and at most the cohort's last day, counted from the
 * stored signals and appended as day rows (zero days too) with the versions they were counted with
 * and the sha256 of the evidence each read. A day is closed once; a recount appends (PR 4/4). Under
 * the account's shared lock (a deletion waits for the close, then marks its rows; a deletion that
 * ran first left no stub, so nothing is written) and the learner's training lock
 * (TRAINING_SQL.learnerLock: a signal reads the clock only under it, so none earlier than the
 * close's clock commits after the close read the evidence), each its own statement, and only while
 * the auth.users stub exists.
 *
 * Callers: scripts/training-time.mjs. Failures return { error, error_type } (tools/core/dbErrors.js),
 * never the driver's text.
 */
import crypto from 'node:crypto';
import { getPool } from '../../server/db.js';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { manifestCanonical, parseCourseManifest, setMsOf } from '../../shared/training/courseManifest.js';
import { cohortRange, countDays, evidenceWindow, jstDayOf, jstDayRange, nextDay } from '../../shared/training/studyTime.js';
import { parseTimeRules } from '../../shared/training/timeRules.js';
import { canonicalUserId } from './accountDeletions.js';
import { classifyDbError } from './dbErrors.js';
import { noDatabase } from './dbTransaction.js';
import { TRAINING_REQUESTS_PER_MINUTE, TRAINING_SQL } from './training.js';

/** @typedef {import('./dbTransaction.js').CoreError} CoreError */
/** @typedef {import('./training.js').TrainingPool} TrainingPool */
/** @typedef {import('./training.js').Queryable} Queryable */
/** @typedef {import('../../shared/training/studyTime.js').Signal} Signal */
/** @typedef {import('../../shared/training/studyTime.js').TimeRules} TimeRules */
/**
 * A cohort's setting, parsed: from which day it applies, its versions, the rules and each unit's set time.
 * @typedef {{ id: string, effectiveFrom: string, ruleSetId: string, catalogVersionId: string, rules: TimeRules, setMs: Map<string, number> }} Setting
 */

/** The flags of a stored signal (training_time_signals.flags). */
export const SIGNAL_FLAGS = Object.freeze({ stop: 1, focus: 2, input: 4 });

/** An instant column as whole epoch milliseconds (the signals store whole milliseconds). @param {string} column */
const ms = (column) => `floor(extract(epoch FROM ${column}) * 1000)::bigint`;

/** The statements, exactly as sent. $1 is the canonical account id where a statement takes one. */
export const TRAINING_TIME_SQL = Object.freeze({
    // Staff: configuration. The rows never change (rp_rows_immutable); the same content is loaded once.
    insertCatalog: 'INSERT INTO training_catalog_versions (course_key, sha256, manifest, loaded_by, note) VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (sha256) DO NOTHING RETURNING id',
    catalogBySha: 'SELECT id, course_key FROM training_catalog_versions WHERE sha256 = $1',
    insertRules: 'INSERT INTO training_time_rule_sets (algorithm, sha256, params, loaded_by, note) VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (sha256) DO NOTHING RETURNING id',
    rulesBySha: 'SELECT id FROM training_time_rule_sets WHERE sha256 = $1',
    // The cohort row locked against a second setting at the same time (FOR NO KEY UPDATE: the foreign
    // key checks of memberships and streams take FOR KEY SHARE and do not wait), with today in Japan.
    cohortForSetting: `SELECT id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
       to_char((clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS today
  FROM training_cohorts WHERE slug = $1 FOR NO KEY UPDATE`,
    settingCourses: `SELECT to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, k.course_key
  FROM training_cohort_time_settings s JOIN training_catalog_versions k ON k.id = s.catalog_version_id
 WHERE s.cohort_id = $1::uuid ORDER BY s.effective_from, s.id`,
    cohortHasEvidence: 'SELECT EXISTS (SELECT 1 FROM training_time_streams WHERE cohort_id = $1::uuid) AS evidence',
    // set_at is the default, the insert's own clock: the CHECK refuses a day before it.
    insertSetting: `INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_by, reason)
VALUES ($1::uuid, $2, $3, $4::date, $5, $6) RETURNING id, to_char(effective_from, 'YYYY-MM-DD') AS effective_from`,
    // Staff: the settings as a list (versions by sha256, never a rule value).
    settingsList: `SELECT s.id, to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, s.set_at, s.set_by, s.reason,
       k.sha256 AS catalog_sha256, k.course_key, jsonb_array_length(k.manifest->'units') AS units, r.sha256 AS rules_sha256, r.algorithm
  FROM training_cohort_time_settings s
  JOIN training_catalog_versions k ON k.id = s.catalog_version_id
  JOIN training_time_rule_sets r ON r.id = s.rule_set_id
 WHERE s.cohort_id = $1::uuid ORDER BY s.effective_from, s.id`,
    // Closing, under the two locks. $2 is the cohort id. The clock is read here, once.
    closeState: `SELECT ${ms('clock_timestamp()')} AS now_ms,
       EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid) AS stub,
       to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on,
       (SELECT to_char((m.added_at AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') FROM training_memberships m
         WHERE m.user_id = $1::uuid AND m.cohort_id = c.id AND m.role = 'learner' AND m.account_deleted_at IS NULL) AS added_on,
       (SELECT to_char(max(d.day), 'YYYY-MM-DD') FROM training_time_days d
         WHERE d.user_id = $1::uuid AND d.cohort_id = c.id AND d.kind = 'close' AND d.account_deleted_at IS NULL) AS last_closed
  FROM training_cohorts c WHERE c.id = $2::uuid`,
    closeSettings: `SELECT s.id, to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, s.rule_set_id, s.catalog_version_id, r.params, k.manifest
  FROM training_cohort_time_settings s
  JOIN training_time_rule_sets r ON r.id = s.rule_set_id
  JOIN training_catalog_versions k ON k.id = s.catalog_version_id
 WHERE s.cohort_id = $1::uuid ORDER BY s.effective_from, s.id`,
    // Each unit's time so far: the current value of every closed day (its newest live row).
    unitTotals: `SELECT u.unit_key, sum(u.counted_ms)::bigint AS counted_ms, sum(u.over_cap_ms)::bigint AS over_cap_ms
  FROM (SELECT DISTINCT ON (day) id FROM training_time_days
         WHERE user_id = $1::uuid AND cohort_id = $2::uuid AND account_deleted_at IS NULL
         ORDER BY day, id DESC) d
  JOIN training_time_unit_days u ON u.day_id = d.id
 GROUP BY u.unit_key ORDER BY u.unit_key`,
    // The live evidence of the days $3..$4 with received_at in [$5, $6] (a stream's signals all fall
    // on its day, and the window reaches at most 6 hours into the days around).
    evidence: `SELECT s.chain_id, s.unit_key, ${ms('s.chain_started_at')} AS born, g.seq, ${ms('g.received_at')} AS at, g.flags
  FROM training_time_streams s
  JOIN training_time_signals g ON g.stream_id = s.id
 WHERE s.user_id = $1::uuid AND s.cohort_id = $2::uuid AND s.account_deleted_at IS NULL
   AND s.day BETWEEN $3::date - 1 AND $4::date + 1
   AND g.received_at BETWEEN $5::timestamptz AND $6::timestamptz
 ORDER BY s.chain_id, g.seq`,
    // Only while the stub exists; computed_at is the default (the insert's clock), so a deletion's
    // mark is never earlier (the CHECK). One close per day (the live-only unique index).
    insertDays: `INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by)
SELECT $1::uuid, $2::uuid, d.day, 'close', d.algorithm, d.rule_set_id, d.catalog_version_id, d.counted_ms, d.over_cap_ms, d.signals, d.evidence_sha256, $3
  FROM unnest($4::date[], $5::text[], $6::bigint[], $7::bigint[], $8::integer[], $9::integer[], $10::integer[], $11::text[])
       AS d(day, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256)
 WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid)
ON CONFLICT (user_id, cohort_id, day) WHERE kind = 'close' AND account_deleted_at IS NULL DO NOTHING
RETURNING id, to_char(day, 'YYYY-MM-DD') AS day`,
    insertUnitDays: 'INSERT INTO training_time_unit_days (day_id, unit_key, counted_ms, over_cap_ms) SELECT * FROM unnest($1::bigint[], $2::text[], $3::integer[], $4::integer[])',
    // Staff: a cohort's live learners, a learner's current days, the cohort's row counts.
    learners: "SELECT user_id FROM training_memberships WHERE cohort_id = $1::uuid AND role = 'learner' AND account_deleted_at IS NULL ORDER BY added_at, id",
    currentDays: `SELECT DISTINCT ON (d.day) to_char(d.day, 'YYYY-MM-DD') AS day, d.kind, d.counted_ms, d.over_cap_ms, d.signals
  FROM training_time_days d
 WHERE d.user_id = $1::uuid AND d.cohort_id = $2::uuid AND d.account_deleted_at IS NULL
 ORDER BY d.day, d.id DESC`,
    cohortStats: `SELECT
  (SELECT count(*) FROM training_memberships WHERE cohort_id = $1::uuid AND role = 'learner' AND account_deleted_at IS NULL) AS learners,
  (SELECT count(*) FROM training_time_streams WHERE cohort_id = $1::uuid) AS streams,
  (SELECT count(*) FROM training_time_streams WHERE cohort_id = $1::uuid AND account_deleted_at IS NOT NULL) AS streams_marked,
  (SELECT count(*) FROM training_time_signals g JOIN training_time_streams s ON s.id = g.stream_id WHERE s.cohort_id = $1::uuid) AS signals,
  (SELECT count(*) FROM training_time_days WHERE cohort_id = $1::uuid) AS days,
  (SELECT count(*) FROM training_time_days WHERE cohort_id = $1::uuid AND account_deleted_at IS NOT NULL) AS days_marked,
  (SELECT to_char(max(day), 'YYYY-MM-DD') FROM training_time_days WHERE cohort_id = $1::uuid AND kind = 'close' AND account_deleted_at IS NULL) AS last_closed`,
});

/** @param {string} text */
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** Trimmed text of 1 to `max` characters, else null (the migration's CHECKs). @param {unknown} value @param {number} max */
const textOf = (value, max) => {
    const text = String(value ?? '').trim();
    return text && Array.from(text).length <= max ? text : null;
};

/** @param {string} day */
const previousDay = (day) => jstDayOf(jstDayRange(day).start - 1);

/** @param {unknown} value @returns {string | null} */
const isoTime = (value) => {
    if (value === null || value === undefined) return null;
    const time = new Date(/** @type {any} */ (value)).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** A stored signal row as the counting reads it. @param {any} row @returns {Signal} */
export function signalOf(row) {
    const flags = Number(row.flags);
    return {
        chain: String(row.chain_id),
        seq: Number(row.seq),
        unit: String(row.unit_key),
        born: Number(row.born),
        at: Number(row.at),
        stop: (flags & SIGNAL_FLAGS.stop) !== 0,
        focus: (flags & SIGNAL_FLAGS.focus) !== 0,
        input: (flags & SIGNAL_FLAGS.input) !== 0,
    };
}

/** @param {Pick<Signal, 'stop' | 'focus' | 'input'>} signal */
export const flagsOf = (signal) => (signal.stop ? SIGNAL_FLAGS.stop : 0) | (signal.focus ? SIGNAL_FLAGS.focus : 0) | (signal.input ? SIGNAL_FLAGS.input : 0);

/**
 * The sha256 of a day's evidence: its signals in chain and sequence order, each as
 * [chain, seq, unit, born, at, flags], in canonical JSON. A recount compares it (PR 4/4).
 * @param {Signal[]} signals
 */
export function evidenceDigest(signals) {
    const rows = [...signals]
        .sort((x, y) => (x.chain < y.chain ? -1 : x.chain > y.chain ? 1 : x.seq - y.seq))
        .map((s) => [s.chain, s.seq, s.unit, s.born, s.at, flagsOf(s)]);
    return sha256(canonicalJson(rows));
}

/**
 * The setting of a day: the latest effective_from on or before it, the later row on the same day
 * (`settings` in the order effective_from, id).
 * @param {Setting[]} settings @param {string} day
 */
export function settingOf(settings, day) {
    /** @type {Setting | null} */
    let found = null;
    for (const setting of settings) if (setting.effectiveFrom <= day) found = setting;
    return found;
}

/**
 * The stored settings rows, parsed again (the rows were checked when loaded; a version that no
 * longer parses with this code stops the counting instead of guessing). null when one fails.
 * @param {any[]} rows
 * @returns {Setting[] | null}
 */
export function parseSettings(rows) {
    /** @type {Setting[]} */
    const out = [];
    for (const row of rows) {
        const rules = parseTimeRules(row.params);
        const manifest = parseCourseManifest(row.manifest);
        if ('errors' in rules || 'errors' in manifest) return null;
        out.push({
            id: String(row.id),
            effectiveFrom: String(row.effective_from),
            ruleSetId: String(row.rule_set_id),
            catalogVersionId: String(row.catalog_version_id),
            rules: rules.rules,
            setMs: setMsOf(manifest.manifest),
        });
    }
    return out;
}

/**
 * The days a close covers: from the day after the last closed one (first: the latest of the day the
 * learner was added, the first setting's day and the cohort's first day) to the last final day (the
 * clock passed its end + gapMs; gapMs is at most 6 hours, so the day before yesterday always is) and
 * at most the cohort's last day.
 * @param {{ nowMs: number, startsOn: string | null, endsOn: string | null, addedOn: string | null, lastClosed: string | null, settings: Setting[] }} input
 * @returns {{ fromDay: string, toDay: string } | { reason: 'not_a_learner' | 'no_dates' | 'not_configured' | 'nothing_final' }}
 */
export function closeRange({ nowMs, startsOn, endsOn, addedOn, lastClosed, settings }) {
    if (!addedOn) return { reason: 'not_a_learner' };
    if (!startsOn || !endsOn || !cohortRange(startsOn, endsOn)) return { reason: 'no_dates' };
    if (!settings.length) return { reason: 'not_configured' };
    const first = [addedOn, settings[0].effectiveFrom, startsOn].sort().at(-1) ?? startsOn;
    const fromDay = lastClosed && nextDay(lastClosed) > first ? nextDay(lastClosed) : first;
    const yesterday = previousDay(jstDayOf(nowMs));
    const setting = settingOf(settings, yesterday);
    const final = !setting || nowMs > jstDayRange(yesterday).end + setting.rules.counting.gapMs ? yesterday : previousDay(yesterday);
    const toDay = final < endsOn ? final : endsOn;
    return fromDay <= toDay ? { fromDay, toDay } : { reason: 'nothing_final' };
}

/**
 * The evidence a close needs: from the first day's start minus the widest look-back of its days'
 * rules to the last day's end plus the widest gap.
 * @param {{ fromDay: string, toDay: string, settings: Setting[] }} input
 */
export function closeWindow({ fromDay, toDay, settings }) {
    let back = 0;
    let ahead = 0;
    for (let day = fromDay; day <= toDay; day = nextDay(day)) {
        const counting = /** @type {Setting} */ (settingOf(settings, day)).rules.counting;
        back = Math.max(back, counting.idleMs, counting.gapMs);
        ahead = Math.max(ahead, counting.gapMs);
    }
    return { from: jstDayRange(fromDay).start - back, to: jstDayRange(toDay).end + ahead };
}

/**
 * @typedef {{ day: string, algorithm: string, ruleSetId: string, catalogVersionId: string, countedMs: number, overCapMs: number,
 *   signals: number, evidenceSha256: string, units: import('../../shared/training/studyTime.js').UnitTime[] }} ClosedDay
 */

/**
 * The day rows of a close: each day counted with its own setting, each unit's set time carried
 * from the closed days before, with the count and the digest of the day's evidence window.
 * @param {{ fromDay: string, toDay: string, signals: Signal[], settings: Setting[], carriedMs: Map<string, number>, startsOn: string, endsOn: string }} input
 * @returns {ClosedDay[]}
 */
export function countClose({ fromDay, toDay, signals, settings, carriedMs, startsOn, endsOn }) {
    const of = (/** @type {string} */ day) => {
        const setting = settingOf(settings, day);
        if (!setting) throw new RangeError(`countClose: no setting for ${day}`);
        return setting;
    };
    const { days } = countDays({ fromDay, toDay, signals, rulesOf: (day) => of(day).rules, setMsOf: (day) => of(day).setMs, carriedMs, cohort: cohortRange(startsOn, endsOn) });
    return days.map((result) => {
        const setting = of(result.day);
        const { start, end } = jstDayRange(result.day);
        const window = evidenceWindow(start, end, setting.rules.counting);
        const evidence = signals.filter((s) => s.at >= window.from && s.at <= window.to);
        return {
            day: result.day,
            algorithm: setting.rules.algorithm,
            ruleSetId: setting.ruleSetId,
            catalogVersionId: setting.catalogVersionId,
            countedMs: result.countedMs,
            overCapMs: result.units.reduce((n, u) => n + u.overCapMs, 0),
            signals: evidence.length,
            evidenceSha256: evidenceDigest(evidence),
            units: result.units,
        };
    });
}

/**
 * One transaction on its own connection. `work` decides whether to commit. A lock wait over
 * TRAINING_LOCK_TIMEOUT (55P03) is 'account_busy'.
 * @template T
 * @param {TrainingPool | null | undefined} pool @param {string} operation
 * @param {(client: Queryable) => Promise<{ commit: boolean, value: T }>} work
 * @returns {Promise<T | CoreError>}
 */
async function transaction(pool, operation, work) {
    if (!pool?.connect) return noDatabase();
    /** @type {any} */
    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), operation);
    }
    let broken = false;
    try {
        await client.query('BEGIN');
        await client.query(TRAINING_SQL.lockTimeout);
        const { commit, value } = await work(client);
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        return value;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            broken = true;
        }
        if (/** @type {any} */ (err)?.code === '55P03') return { error: 'The account is busy. Try again.', error_type: 'account_busy' };
        return classifyDbError(/** @type {any} */ (err), operation);
    } finally {
        client.release(broken);
    }
}

/**
 * Staff: load a unit list (risepath.training-course/v1) as an immutable version. The same content
 * (any key order or formatting) is the version already there.
 * @param {{ input: unknown, loadedBy: unknown, note: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'loaded' | 'exists', id: string, sha256: string, courseKey: string, units: number }
 *   | { status: 'invalid', errors: string[] } | CoreError>}
 */
export async function loadCatalog({ input, loadedBy, note, pool = getPool() }) {
    const by = textOf(loadedBy, 100);
    const why = textOf(note, 500);
    if (!by || !why) return { error: 'Who loads it takes 1 to 100 characters and the note 1 to 500.', error_type: 'validation' };
    const parsed = parseCourseManifest(input);
    if ('errors' in parsed) return { status: 'invalid', errors: parsed.errors };
    const text = manifestCanonical(parsed.manifest);
    const hash = sha256(text);
    if (!pool) return noDatabase();
    try {
        const inserted = (await pool.query(TRAINING_TIME_SQL.insertCatalog, [parsed.manifest.courseKey, hash, text, by, why])).rows?.[0];
        const row = inserted ?? (await pool.query(TRAINING_TIME_SQL.catalogBySha, [hash])).rows?.[0];
        if (!row) return { error: 'The unit list could not be read back.', error_type: 'unknown' };
        return { status: inserted ? 'loaded' : 'exists', id: String(row.id), sha256: hash, courseKey: parsed.manifest.courseKey, units: parsed.manifest.units.length };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'loadCatalog');
    }
}

/**
 * Staff: load a rules file as an immutable version (its signals must fit in half of the API's
 * per-learner limit). Errors name fields, never values; the result has no value either.
 * @param {{ input: unknown, loadedBy: unknown, note: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'loaded' | 'exists', id: string, sha256: string, algorithm: string }
 *   | { status: 'invalid', errors: string[] } | CoreError>}
 */
export async function loadRules({ input, loadedBy, note, pool = getPool() }) {
    const by = textOf(loadedBy, 100);
    const why = textOf(note, 500);
    if (!by || !why) return { error: 'Who loads it takes 1 to 100 characters and the note 1 to 500.', error_type: 'validation' };
    const parsed = parseTimeRules(input, { requestsPerMinute: TRAINING_REQUESTS_PER_MINUTE });
    if ('errors' in parsed) return { status: 'invalid', errors: parsed.errors };
    const text = canonicalJson(parsed.rules);
    const hash = sha256(text);
    if (!pool) return noDatabase();
    try {
        const inserted = (await pool.query(TRAINING_TIME_SQL.insertRules, [parsed.rules.algorithm, hash, text, by, why])).rows?.[0];
        const row = inserted ?? (await pool.query(TRAINING_TIME_SQL.rulesBySha, [hash])).rows?.[0];
        if (!row) return { error: 'The rules could not be read back.', error_type: 'unknown' };
        return { status: inserted ? 'loaded' : 'exists', id: String(row.id), sha256: hash, algorithm: parsed.rules.algorithm };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'loadRules');
    }
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Staff: a cohort uses a unit list and rules (by sha256) from a Japan-time day. Refused: a cohort
 * without both dates (it counts nothing), a day before today or after the cohort's last day, today
 * when a setting is already in effect (from tomorrow then), and a unit list of another course once
 * the cohort has evidence.
 * @param {{ cohortSlug: string, catalogSha256: string, rulesSha256: string, effectiveFrom: string, setBy: unknown, reason: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'set', id: string, effectiveFrom: string }
 *   | { status: 'no_cohort' | 'no_dates' | 'no_catalog' | 'no_rules' | 'after_end' | 'course_differs' }
 *   | { status: 'past' | 'in_effect_today', today: string }
 *   | CoreError>}
 */
export async function setCohortTime({ cohortSlug, catalogSha256, rulesSha256, effectiveFrom, setBy, reason, pool = getPool() }) {
    const by = textOf(setBy, 100);
    const why = textOf(reason, 500);
    if (!by || !why) return { error: 'Who sets it takes 1 to 100 characters and the reason 1 to 500.', error_type: 'validation' };
    if (!SHA256.test(String(catalogSha256)) || !SHA256.test(String(rulesSha256))) return { error: 'The unit list and the rules are named by their sha256 (64 lower-case hex digits).', error_type: 'validation' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom))) return { error: 'The day is YYYY-MM-DD.', error_type: 'validation' };
    try {
        jstDayRange(effectiveFrom);
    } catch {
        return { error: 'The day is YYYY-MM-DD.', error_type: 'validation' };
    }
    return transaction(pool, 'setCohortTime', async (db) => {
        const cohort = (await db.query(TRAINING_TIME_SQL.cohortForSetting, [cohortSlug])).rows?.[0];
        /** @param {any} value */
        const refuse = (value) => ({ commit: false, value });
        if (!cohort) return refuse({ status: 'no_cohort' });
        if (!cohort.starts_on || !cohort.ends_on) return refuse({ status: 'no_dates' });
        const catalog = (await db.query(TRAINING_TIME_SQL.catalogBySha, [catalogSha256])).rows?.[0];
        if (!catalog) return refuse({ status: 'no_catalog' });
        const rules = (await db.query(TRAINING_TIME_SQL.rulesBySha, [rulesSha256])).rows?.[0];
        if (!rules) return refuse({ status: 'no_rules' });
        const today = String(cohort.today);
        if (effectiveFrom < today) return refuse({ status: 'past', today });
        if (effectiveFrom > cohort.ends_on) return refuse({ status: 'after_end' });
        const earlier = (await db.query(TRAINING_TIME_SQL.settingCourses, [cohort.id])).rows ?? [];
        if (effectiveFrom <= today && earlier.some((s) => String(s.effective_from) <= today)) return refuse({ status: 'in_effect_today', today });
        if (earlier.some((s) => String(s.course_key) !== String(catalog.course_key))
            && (await db.query(TRAINING_TIME_SQL.cohortHasEvidence, [cohort.id])).rows?.[0]?.evidence) {
            return refuse({ status: 'course_differs' });
        }
        try {
            const row = (await db.query(TRAINING_TIME_SQL.insertSetting, [cohort.id, catalog.id, rules.id, effectiveFrom, by, why])).rows?.[0];
            return { commit: true, value: { status: 'set', id: String(row?.id), effectiveFrom: String(row?.effective_from) } };
        } catch (err) {
            // 23514: midnight passed between the reads above and the insert (the CHECK uses the insert's clock).
            if (/** @type {any} */ (err)?.code === '23514') return refuse({ status: 'past', today });
            throw err;
        }
    });
}

/**
 * Close a learner's final days in a cohort (the header). One short transaction.
 * @param {{ userId: unknown, cohortId: unknown, computedBy: string, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'closed', days: number, fromDay: string, toDay: string }
 *   | { status: 'nothing', reason: 'no_cohort' | 'no_account' | 'not_a_learner' | 'no_dates' | 'not_configured' | 'nothing_final' }
 *   | CoreError>} CoreError 'account_busy' when a lock wait passed TRAINING_LOCK_TIMEOUT,
 *   'invalid_setting' when a stored version does not parse with this code
 */
export async function closeDays({ userId: rawUserId, cohortId: rawCohortId, computedBy, pool = getPool() }) {
    const userId = canonicalUserId(rawUserId);
    const cohortId = canonicalUserId(rawCohortId);
    if (!userId || !cohortId) return { error: 'An account id and a cohort id (UUIDs) are required.', error_type: 'validation' };
    const by = textOf(computedBy, 100);
    if (!by) return { error: 'Who closes takes 1 to 100 characters.', error_type: 'validation' };
    return transaction(pool, 'closeDays', async (db) => {
        await db.query(TRAINING_SQL.lock, [userId]);
        await db.query(TRAINING_SQL.learnerLock, [userId]);
        /** @param {any} reason */
        const nothing = (reason) => ({ commit: false, value: /** @type {any} */ ({ status: 'nothing', reason }) });
        const state = (await db.query(TRAINING_TIME_SQL.closeState, [userId, cohortId])).rows?.[0];
        if (!state) return nothing('no_cohort');
        if (!state.stub) return nothing('no_account');
        const settings = parseSettings((await db.query(TRAINING_TIME_SQL.closeSettings, [cohortId])).rows ?? []);
        if (!settings) return { commit: false, value: /** @type {any} */ ({ error: 'A stored rules or unit list version does not parse with this code.', error_type: 'invalid_setting' }) };
        const range = closeRange({ nowMs: Number(state.now_ms), startsOn: state.starts_on, endsOn: state.ends_on, addedOn: state.added_on, lastClosed: state.last_closed, settings });
        if ('reason' in range) return nothing(range.reason);
        const carriedMs = new Map(((await db.query(TRAINING_TIME_SQL.unitTotals, [userId, cohortId])).rows ?? []).map((r) => [String(r.unit_key), Number(r.counted_ms)]));
        const window = closeWindow({ ...range, settings });
        const signals = ((await db.query(TRAINING_TIME_SQL.evidence, [userId, cohortId, range.fromDay, range.toDay, new Date(window.from).toISOString(), new Date(window.to).toISOString()])).rows ?? []).map(signalOf);
        const days = countClose({ ...range, signals, settings, carriedMs, startsOn: String(state.starts_on), endsOn: String(state.ends_on) });
        const written = (await db.query(TRAINING_TIME_SQL.insertDays, [
            userId, cohortId, by,
            days.map((d) => d.day), days.map((d) => d.algorithm), days.map((d) => d.ruleSetId), days.map((d) => d.catalogVersionId),
            days.map((d) => d.countedMs), days.map((d) => d.overCapMs), days.map((d) => d.signals), days.map((d) => d.evidenceSha256),
        ])).rows ?? [];
        // Under the learner's lock no other close runs, and under the account lock the stub stays:
        // anything but every day written is a fault, and nothing is kept.
        if (written.length !== days.length) return { commit: false, value: /** @type {any} */ ({ error: 'The days could not be written.', error_type: 'unknown' }) };
        const idOf = new Map(written.map((r) => [String(r.day), String(r.id)]));
        const units = days.flatMap((d) => d.units.filter((u) => u.countedMs > 0 || u.overCapMs > 0).map((u) => ({ id: idOf.get(d.day), ...u })));
        if (units.length) {
            await db.query(TRAINING_TIME_SQL.insertUnitDays, [units.map((u) => u.id), units.map((u) => u.unit), units.map((u) => u.countedMs), units.map((u) => u.overCapMs)]);
        }
        return { commit: true, value: { status: 'closed', days: days.length, fromDay: range.fromDay, toDay: range.toDay } };
    });
}

/**
 * Staff: a cohort's id and dates by slug (null when there is none).
 * @param {{ cohortSlug: string, pool?: TrainingPool | null }} params
 * @returns {Promise<{ id: string, slug: string, name: string, startsOn: string | null, endsOn: string | null } | null | CoreError>}
 */
export async function cohortBySlug({ cohortSlug, pool = getPool() }) {
    if (!pool) return noDatabase();
    try {
        const row = (await pool.query(TRAINING_SQL.cohortBySlug, [cohortSlug])).rows?.[0];
        return row ? { id: String(row.id), slug: String(row.slug), name: String(row.name), startsOn: row.starts_on ?? null, endsOn: row.ends_on ?? null } : null;
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'cohortBySlug');
    }
}

/**
 * Staff: the live learners of a cohort, in the order they were added.
 * @param {{ cohortId: string, pool?: TrainingPool | null }} params
 * @returns {Promise<string[] | CoreError>}
 */
export async function cohortLearners({ cohortId, pool = getPool() }) {
    if (!pool) return noDatabase();
    try {
        return ((await pool.query(TRAINING_TIME_SQL.learners, [cohortId])).rows ?? []).map((r) => String(r.user_id));
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'cohortLearners');
    }
}

/**
 * Staff: a cohort's settings, oldest first (versions by sha256; never a rule value).
 * @param {{ cohortId: string, pool?: TrainingPool | null }} params
 */
export async function cohortSettings({ cohortId, pool = getPool() }) {
    if (!pool) return noDatabase();
    try {
        return ((await pool.query(TRAINING_TIME_SQL.settingsList, [cohortId])).rows ?? []).map((r) => ({
            id: String(r.id),
            effectiveFrom: String(r.effective_from),
            setAt: isoTime(r.set_at),
            setBy: String(r.set_by),
            reason: String(r.reason),
            catalogSha256: String(r.catalog_sha256),
            courseKey: String(r.course_key),
            units: Number(r.units),
            rulesSha256: String(r.rules_sha256),
            algorithm: String(r.algorithm),
        }));
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'cohortSettings');
    }
}

/**
 * Staff: a learner's closed days (each day's current value) and each unit's total, live rows only.
 * @param {{ userId: unknown, cohortId: string, pool?: TrainingPool | null }} params
 */
export async function learnerDays({ userId: rawUserId, cohortId, pool = getPool() }) {
    const userId = canonicalUserId(rawUserId);
    if (!userId) return { error: 'An account id (a UUID) is required.', error_type: 'validation' };
    if (!pool) return noDatabase();
    try {
        const days = ((await pool.query(TRAINING_TIME_SQL.currentDays, [userId, cohortId])).rows ?? []).map((r) => ({
            day: String(r.day), kind: String(r.kind), countedMs: Number(r.counted_ms), overCapMs: Number(r.over_cap_ms), signals: Number(r.signals),
        }));
        const units = ((await pool.query(TRAINING_TIME_SQL.unitTotals, [userId, cohortId])).rows ?? []).map((r) => ({
            unitKey: String(r.unit_key), countedMs: Number(r.counted_ms), overCapMs: Number(r.over_cap_ms),
        }));
        return { userId, days, units };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'learnerDays');
    }
}

/**
 * Staff: how many rows a cohort has (marked ones too), and its last closed day.
 * @param {{ cohortId: string, pool?: TrainingPool | null }} params
 */
export async function cohortStats({ cohortId, pool = getPool() }) {
    if (!pool) return noDatabase();
    try {
        const r = (await pool.query(TRAINING_TIME_SQL.cohortStats, [cohortId])).rows?.[0] ?? {};
        return {
            learners: Number(r.learners ?? 0),
            streams: Number(r.streams ?? 0),
            streamsMarked: Number(r.streams_marked ?? 0),
            signals: Number(r.signals ?? 0),
            days: Number(r.days ?? 0),
            daysMarked: Number(r.days_marked ?? 0),
            lastClosed: r.last_closed ? String(r.last_closed) : null,
        };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'cohortStats');
    }
}
