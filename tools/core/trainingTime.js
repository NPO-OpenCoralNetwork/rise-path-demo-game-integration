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
 * never from a day before today, and once one is in effect, from tomorrow at the earliest; once
 * the cohort has evidence, only for the course in effect today. A new setting holds the cohort's
 * settings lock (TRAINING_TIME_SQL.settingsLock) exclusively and decides with one clock reading;
 * a close and a signal hold it shared before they read the clock and the day's setting, so a day
 * is counted with one setting. Nothing has a default: a day without a setting counts nothing (D9).
 * The rule values go only to the counting and to admitSignal; the one that leaves this module is
 * the collection's beatMs: GET .../time names it while the cohort is in session, and a signal's
 * answer gives it as nextInMs (or null: the page sends no more signals of that chain).
 *
 * A signal (recordSignal, POST .../time/signals): one short transaction under the account's shared
 * lock, the learner's training lock and the cohort's settings lock shared (as a close, below), then
 * one statement that reads the database clock once (whole milliseconds) and what admitSignal
 * (shared/training/studyTime.js) decides with. An accepted signal is stored with that clock, only
 * while the stub exists, in the stream row of its Japan-time day (a chain across 00:00 gets one row
 * per day: closing reads a day's evidence from the streams of the days around it); a clock that
 * went back into a closed day's evidence window stores nothing. Then, when a day became final,
 * closeDays in its own transaction (if it fails, the signal stays stored), and, unless it is a stop,
 * the live values in one read-only snapshot.
 *
 * Live values (liveTime: GET .../time, and a signal's answer): the closed days' current rows, and
 * the days not closed yet counted from the evidence with the function a close uses, never stored,
 * up to the instant no other open page's next signal can change (settledUntil): no number goes down.
 *
 * Closing (closeDays): a learner's days, from the first one not closed yet up to the last final one
 * (the database clock passed its end + gapMs) and at most the cohort's last day, counted from the
 * stored signals and appended as day rows (zero days too) with the versions they were counted with
 * and the sha256 of the evidence each read. A day is closed once; a recount appends (PR 4/4). Under
 * the account's shared lock (a deletion waits for the close, then marks its rows; a deletion that
 * ran first left no stub, so nothing is written), the learner's training lock
 * (TRAINING_SQL.learnerLock: a signal reads the clock only under it, so none earlier than the
 * close's clock commits after the close read the evidence) and the cohort's settings lock shared,
 * in that order, each its own statement, and only while the auth.users stub exists.
 *
 * Callers: scripts/training-time.mjs and server/routes/trainingTime.js (used by
 * server/routes/training.js). Failures return { error, error_type } (tools/core/dbErrors.js), never
 * the driver's text.
 */
import crypto from 'node:crypto';
import { getPool } from '../../server/db.js';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { TRAINING_KEY, manifestCanonical, parseCourseManifest, setMsOf } from '../../shared/training/courseManifest.js';
import { admitSignal, cohortRange, countDays, countSpan, evidenceWindow, jstDayOf, jstDayRange, nextDay, studyReason } from '../../shared/training/studyTime.js';
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
/** @typedef {import('../../shared/training/studyTime.js').StudyReason} StudyReason */
/** @typedef {import('../../shared/training/courseManifest.js').CourseUnit} CourseUnit */
/**
 * A cohort's setting, parsed: from which day it applies, its versions, the rules, its units (in the
 * unit list's order, with their titles) and each unit's set time.
 * @typedef {{ id: string, effectiveFrom: string, ruleSetId: string, catalogVersionId: string, rules: TimeRules, units: CourseUnit[], setMs: Map<string, number> }} Setting
 */
/**
 * A signal as the page sends it (POST .../time/signals): exactly these keys, no time or duration.
 * @typedef {{ unitKey: string, chainId: string, seq: number, stop: boolean, focus: boolean, input: boolean }} SignalBody
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
    // Cohorts are never deleted and their dates never change, so these are read before the lock.
    cohortForSetting: "SELECT id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on FROM training_cohorts WHERE slug = $1",
    // A cohort's settings lock ($1 the cohort id): a new setting takes it exclusively before it reads
    // the clock; a close and a signal take it shared before reading the clock and the day's setting.
    // So a reader never misses a setting whose clock reading came before its own, and one day is
    // counted with one setting. Taken after the learner's locks, never before them.
    settingsLock: "SELECT pg_advisory_xact_lock(hashtextextended('rp:training-settings:' || $1::uuid::text, 0))",
    settingsLockShared: "SELECT pg_advisory_xact_lock_shared(hashtextextended('rp:training-settings:' || $1::uuid::text, 0))",
    jstToday: "SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS today",
    settingCourses: `SELECT to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, k.course_key
  FROM training_cohort_time_settings s JOIN training_catalog_versions k ON k.id = s.catalog_version_id
 WHERE s.cohort_id = $1::uuid ORDER BY s.effective_from, s.id`,
    cohortHasEvidence: 'SELECT EXISTS (SELECT 1 FROM training_time_streams WHERE cohort_id = $1::uuid) AS evidence',
    // One clock reading decides it, is the row's set_at (so the CHECK holds) and is returned as today:
    // not before today, and from tomorrow once a setting is in effect today. No id: refused.
    insertSetting: `WITH t AS (SELECT clock_timestamp() AS at),
d AS (SELECT at, (at AT TIME ZONE 'Asia/Tokyo')::date AS today FROM t),
ins AS (
  INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_at, set_by, reason)
  SELECT $1::uuid, $2, $3, $4::date, d.at, $5, $6 FROM d
   WHERE $4::date > d.today
      OR ($4::date = d.today AND NOT EXISTS (SELECT 1 FROM training_cohort_time_settings s WHERE s.cohort_id = $1::uuid AND s.effective_from <= d.today))
  RETURNING id, to_char(effective_from, 'YYYY-MM-DD') AS effective_from)
SELECT to_char(d.today, 'YYYY-MM-DD') AS today, ins.id, ins.effective_from FROM d LEFT JOIN ins ON true`,
    // Staff: the settings as a list (versions by sha256, never a rule value).
    settingsList: `SELECT s.id, to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, s.set_at, s.set_by, s.reason,
       k.sha256 AS catalog_sha256, k.course_key, jsonb_array_length(k.manifest->'units') AS units, r.sha256 AS rules_sha256, r.algorithm
  FROM training_cohort_time_settings s
  JOIN training_catalog_versions k ON k.id = s.catalog_version_id
  JOIN training_time_rule_sets r ON r.id = s.rule_set_id
 WHERE s.cohort_id = $1::uuid ORDER BY s.effective_from, s.id`,
    // A signal, under the account's shared lock, the learner's lock and the settings lock shared. $2
    // the cohort id, $3 the chain id, $4 the unit key. The clock is read here, once, in whole
    // milliseconds (the inserts take it as a parameter). One row, with or without a cohort: the stub;
    // the live membership (any role) and its day; the cohort's dates and first setting day; today's
    // setting (its rules; whether its unit list has the unit) and yesterday's gapMs (when a close may
    // find yesterday final); the chain's last signal over every live stream of the account (a chain
    // of another cohort or unit is refused); the last signal of each chain of the cohort seen today
    // or yesterday (an open chain's last signal is at most gapMs old, and timeRules.js caps gapMs at
    // 6 hours); the last closed day and the end of its evidence window (its end + the gapMs it was
    // counted with).
    signalState: `WITH t AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS at),
d AS (SELECT at, (at AT TIME ZONE 'Asia/Tokyo')::date AS today FROM t)
SELECT ${ms('d.at')} AS now_ms,
       EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid) AS stub,
       c.id AS cohort_id, mb.role, mb.added_on,
       to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on,
       (SELECT to_char(min(f.effective_from), 'YYYY-MM-DD') FROM training_cohort_time_settings f WHERE f.cohort_id = c.id) AS first_setting,
       (SELECT (y.params #>> '{counting,gapMs}')::bigint FROM training_cohort_time_settings s JOIN training_time_rule_sets y ON y.id = s.rule_set_id
         WHERE s.cohort_id = c.id AND s.effective_from <= d.today - 1 ORDER BY s.effective_from DESC, s.id DESC LIMIT 1) AS yesterday_gap_ms,
       st.params, st.unit_known,
       ch.cohort_id AS chain_cohort_id, ch.unit_key AS chain_unit_key, ch.born AS chain_born, ch.seq AS chain_seq, ch.at AS chain_at, ch.flags AS chain_flags,
       (SELECT coalesce(json_agg(json_build_object('chain_id', p.chain_id, 'born', p.born, 'at', p.at, 'flags', p.flags) ORDER BY p.chain_id), '[]'::json)
          FROM (SELECT DISTINCT ON (s.chain_id) s.chain_id, ${ms('s.chain_started_at')} AS born, ${ms('l.received_at')} AS at, l.flags
                  FROM training_time_streams s
                  CROSS JOIN LATERAL (SELECT g.received_at, g.seq, g.flags FROM training_time_signals g
                                       WHERE g.stream_id = s.id ORDER BY g.seq DESC LIMIT 1) l
                 WHERE s.user_id = $1::uuid AND s.cohort_id = c.id AND s.account_deleted_at IS NULL AND s.day >= d.today - 1
                 ORDER BY s.chain_id, l.seq DESC) p) AS places,
       lc.last_closed, lc.closed_until_ms
  FROM d
  LEFT JOIN training_cohorts c ON c.id = $2::uuid
  LEFT JOIN LATERAL (SELECT m.role, to_char((m.added_at AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS added_on
                       FROM training_memberships m
                      WHERE m.user_id = $1::uuid AND m.cohort_id = c.id AND m.account_deleted_at IS NULL) mb ON true
  LEFT JOIN LATERAL (SELECT r.params, k.manifest->'units' @> jsonb_build_array(jsonb_build_object('key', $4::text)) AS unit_known
                       FROM training_cohort_time_settings s
                       JOIN training_time_rule_sets r ON r.id = s.rule_set_id
                       JOIN training_catalog_versions k ON k.id = s.catalog_version_id
                      WHERE s.cohort_id = c.id AND s.effective_from <= d.today
                      ORDER BY s.effective_from DESC, s.id DESC LIMIT 1) st ON true
  LEFT JOIN LATERAL (SELECT s.cohort_id, s.unit_key, ${ms('s.chain_started_at')} AS born, l.seq, ${ms('l.received_at')} AS at, l.flags
                       FROM training_time_streams s
                       CROSS JOIN LATERAL (SELECT g.seq, g.received_at, g.flags FROM training_time_signals g
                                            WHERE g.stream_id = s.id ORDER BY g.seq DESC LIMIT 1) l
                      WHERE s.user_id = $1::uuid AND s.chain_id = $3::uuid AND s.account_deleted_at IS NULL
                      ORDER BY l.seq DESC LIMIT 1) ch ON true
  LEFT JOIN LATERAL (SELECT to_char(x.day, 'YYYY-MM-DD') AS last_closed,
                            ${ms("((x.day + 1)::timestamp AT TIME ZONE 'Asia/Tokyo')")} + (r.params #>> '{counting,gapMs}')::bigint AS closed_until_ms
                       FROM training_time_days x JOIN training_time_rule_sets r ON r.id = x.rule_set_id
                      WHERE x.user_id = $1::uuid AND x.cohort_id = c.id AND x.kind = 'close' AND x.account_deleted_at IS NULL
                      ORDER BY x.day DESC LIMIT 1) lc ON true`,
    // Only while the stub exists. The stream of the signal's Japan-time day, from the same clock
    // reading as its signal ($6; the CHECK), once per chain and day (the live-only unique index): a
    // chain's first signal of a day makes it. $5 is the chain's first signal's time (the same on
    // every day's row).
    insertStream: `INSERT INTO training_time_streams (user_id, cohort_id, unit_key, chain_id, chain_started_at, day, started_at)
SELECT $1::uuid, $2::uuid, $3, $4::uuid, $5::timestamptz, ($6::timestamptz AT TIME ZONE 'Asia/Tokyo')::date, $6::timestamptz
 WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid)
ON CONFLICT (user_id, chain_id, day) WHERE account_deleted_at IS NULL DO NOTHING`,
    // Into the live stream of the signal's day ($3); only while the stub exists. $2 the chain id.
    insertSignal: `INSERT INTO training_time_signals (stream_id, received_at, seq, flags)
SELECT s.id, $3::timestamptz, $4::integer, $5::smallint FROM training_time_streams s
 WHERE s.user_id = $1::uuid AND s.chain_id = $2::uuid AND s.account_deleted_at IS NULL
   AND s.day = ($3::timestamptz AT TIME ZONE 'Asia/Tokyo')::date
   AND EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid)
ON CONFLICT (stream_id, seq) DO NOTHING
RETURNING seq`,
    // The live values read in one snapshot (closeState, closeSettings, unitTotals, currentDays,
    // evidence): a close committing between two reads would count a day twice or not at all.
    beginRead: 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    // Closing, under the three locks; the live values, in one snapshot. $2 is the cohort id. The
    // clock is read here, once.
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
    // The live evidence of the days $3..$4 with received_at in [$5, $6] (recordSignal stores every
    // signal in the stream of its own day, and the window reaches at most 6 hours into the days around).
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
            units: manifest.manifest.units,
            setMs: setMsOf(manifest.manifest),
        });
    }
    return out;
}

/**
 * The first day a learner's time counts (the latest of the day the learner was added, the first
 * setting's day and the cohort's first day), and the first day not closed yet.
 * @param {{ addedOn: string, firstSetting: string, startsOn: string, lastClosed: string | null }} input
 */
function openFrom({ addedOn, firstSetting, startsOn, lastClosed }) {
    const first = [addedOn, firstSetting, startsOn].sort().at(-1) ?? startsOn;
    return { first, fromDay: lastClosed && nextDay(lastClosed) > first ? nextDay(lastClosed) : first };
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
    const { fromDay } = openFrom({ addedOn, firstSetting: settings[0].effectiveFrom, startsOn, lastClosed });
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

const SIGNAL_KEYS = Object.freeze(['chainId', 'focus', 'input', 'seq', 'stop', 'unitKey']);
const MAX_SEQ = 2_147_483_647;

/**
 * A signal's body (POST .../time/signals), or null: a plain object with exactly the keys unitKey,
 * chainId, seq, stop, focus and input (a time, a duration or any other key refuses it): a unit key,
 * a UUID (lower-cased: chain ids are compared as text), an integer 0..2^31-1 and three booleans.
 * @param {unknown} body
 * @returns {SignalBody | null}
 */
export function readSignalBody(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    // Every own key (non-enumerable and symbol keys too), so nothing beside the six slips through.
    const keys = Reflect.ownKeys(body);
    if (keys.length !== SIGNAL_KEYS.length || !SIGNAL_KEYS.every((key) => keys.includes(key))) return null;
    const { unitKey, chainId, seq, stop, focus, input } = /** @type {Record<string, unknown>} */ (body);
    const chain = canonicalUserId(chainId);
    if (typeof unitKey !== 'string' || !TRAINING_KEY.test(unitKey) || !chain) return null;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) return null;
    if (typeof stop !== 'boolean' || typeof focus !== 'boolean' || typeof input !== 'boolean') return null;
    return { unitKey, chainId: chain, seq, stop, focus, input };
}

/**
 * Whether a close after a signal at nowMs finds a final day (transaction 2): closeRange's rule
 * without reading every setting. The first day not closed yet is at or before the last final one:
 * yesterday once the clock passed its end + yesterday's gapMs (or when no setting covers yesterday),
 * else the day before. closeDays decides again under its locks.
 * @param {{ nowMs: number, startsOn: string | null, endsOn: string | null, addedOn: string | null, firstSetting: string | null, lastClosed: string | null, yesterdayGapMs: number | null }} input
 *   yesterdayGapMs: the gapMs of yesterday's setting, null when none
 */
export function closeDue({ nowMs, startsOn, endsOn, addedOn, firstSetting, lastClosed, yesterdayGapMs }) {
    if (!addedOn || !firstSetting || !startsOn || !endsOn || !cohortRange(startsOn, endsOn)) return false;
    const { fromDay } = openFrom({ addedOn, firstSetting, startsOn, lastClosed });
    const yesterday = previousDay(jstDayOf(nowMs));
    const final = yesterdayGapMs === null || nowMs > jstDayRange(yesterday).end + yesterdayGapMs ? yesterday : previousDay(yesterday);
    return fromDay <= (final < endsOn ? final : endsOn);
}

/** How many days GET .../time lists, the newest first. */
export const LIVE_DAYS = 14;

/**
 * The days of a learner's live values at nowMs: from the first day that counts to today (at most the
 * cohort's last day), and the days among them not closed yet (live; null when none). null when
 * nothing counts: not a learner, a cohort without both dates, no setting.
 * @param {{ nowMs: number, startsOn: string | null, endsOn: string | null, addedOn: string | null, lastClosed: string | null, settings: Setting[] }} input
 * @returns {{ first: string, toDay: string, live: { fromDay: string, toDay: string } | null } | null}
 */
export function liveRange({ nowMs, startsOn, endsOn, addedOn, lastClosed, settings }) {
    if (!addedOn || !startsOn || !endsOn || !cohortRange(startsOn, endsOn) || !settings.length) return null;
    const { first, fromDay } = openFrom({ addedOn, firstSetting: settings[0].effectiveFrom, startsOn, lastClosed });
    const today = jstDayOf(nowMs);
    const toDay = today < endsOn ? today : endsOn;
    return { first, toDay, live: fromDay <= toDay ? { fromDay, toDay } : null };
}

/**
 * @typedef {{ unitKey: string, title: { jp: string, en: string }, setMs: number, countedMs: number, capReached: boolean }} LiveUnit
 * @typedef {{ day: string, countedMs: number, final: boolean }} LiveDay
 * @typedef {{ nowMs: number, startsOn: string | null, endsOn: string | null, addedOn: string | null, lastClosed: string | null, settings: Setting[],
 *   closedDays: { day: string, countedMs: number }[], unitTotals: Map<string, number>, signals: Signal[] }} LiveInput
 */

/**
 * The instant up to which the stored evidence settles the count at nowMs: no later signal can change
 * an earlier instant (a chain's next pair starts at its last signal; a new chain's pairs and a new
 * input start at nowMs or later). The earliest last signal of the chains still open (not stopped, at
 * most the gapMs of its day or the next day old), else nowMs.
 * @param {{ nowMs: number, signals: Signal[], settings: Setting[] }} input signals: the evidence up to nowMs
 */
export function settledUntil({ nowMs, signals, settings }) {
    /** @type {Map<string, Signal>} */
    const last = new Map();
    for (const s of signals) {
        const seen = last.get(s.chain);
        if (!seen || s.seq > seen.seq) last.set(s.chain, s);
    }
    const gapOf = (/** @type {string} */ day) => settingOf(settings, day)?.rules.counting.gapMs ?? 0;
    let until = nowMs;
    for (const l of last.values()) {
        if (l.stop || l.at >= until) continue;
        const day = jstDayOf(l.at);
        if (nowMs - l.at <= Math.max(gapOf(day), gapOf(nextDay(day)))) until = l.at;
    }
    return until;
}

/**
 * A learner's study time in a cohort at nowMs: each closed day's current value, and the days not
 * closed yet counted from `signals` with each unit's time carried from the closed days, as the close
 * will count them, up to settledUntil (never stored). So no number goes down from one answer to the
 * next (a recount aside): what another open page's next signal can still change is not counted yet.
 * status: 'not_configured' (no setting today, so nothing was ever counted), 'not_in_session'
 * (outside the cohort's dates, or a date missing) or 'ready'. units: today's unit list in its order,
 * each with its time over every day (closed and live). days: the newest LIVE_DAYS days from today
 * (at most the cohort's last day), not before the first day that counts; final: closed. totalMs:
 * every day, units no longer listed too.
 * @param {LiveInput} input closedDays: currentDays; unitTotals: each unit's time on the closed days
 */
export function liveTime({ nowMs, startsOn, endsOn, addedOn, lastClosed, settings, closedDays, unitTotals, signals }) {
    const today = jstDayOf(nowMs);
    const setting = settingOf(settings, today);
    const cohort = cohortRange(startsOn, endsOn);
    const range = liveRange({ nowMs, startsOn, endsOn, addedOn, lastClosed, settings });
    const of = (/** @type {string} */ day) => {
        const found = settingOf(settings, day);
        if (!found) throw new RangeError(`liveTime: no setting for ${day}`);
        return found;
    };
    const until = settledUntil({ nowMs, signals, settings });
    /** @type {{ days: Array<{ day: string, countedMs: number }>, carriedAfterMs: Map<string, number> }} */
    const counted = { days: [], carriedAfterMs: new Map(unitTotals) };
    for (let day = range?.live?.fromDay ?? ''; range?.live && day <= range.live.toDay; day = nextDay(day)) {
        const { start, end } = jstDayRange(day);
        const daySetting = of(day);
        const span = countSpan({ a: start, b: Math.min(end, Math.max(start, until)), signals, rules: daySetting.rules, setMs: daySetting.setMs, carriedMs: counted.carriedAfterMs, cohort });
        counted.days.push({ day, countedMs: span.countedMs });
        counted.carriedAfterMs = span.carriedAfterMs;
    }
    /** @type {Map<string, LiveDay>} */
    const byDay = new Map(closedDays.map((d) => [d.day, { day: d.day, countedMs: d.countedMs, final: true }]));
    for (const d of counted.days) if (!byDay.has(d.day)) byDay.set(d.day, { day: d.day, countedMs: d.countedMs, final: false });
    // Every day from the first one is closed (a close covers the days from the first not closed) or live.
    /** @type {LiveDay[]} */
    const days = [];
    for (let day = range?.toDay ?? ''; range && day >= range.first && days.length < LIVE_DAYS; day = previousDay(day)) {
        const found = byDay.get(day);
        if (found) days.push(found);
    }
    /** @type {LiveUnit[]} */
    const units = (setting?.units ?? []).map((u) => {
        const setMs = /** @type {number} */ (setting?.setMs.get(u.key));
        const countedMs = counted.carriedAfterMs.get(u.key) ?? 0;
        return { unitKey: u.key, title: { jp: u.title.jp, en: u.title.en }, setMs, countedMs, capReached: countedMs >= setMs };
    });
    /** @type {'not_configured' | 'not_in_session' | 'ready'} */
    const status = !setting ? 'not_configured' : !cohort || nowMs < cohort.from || nowMs >= cohort.to ? 'not_in_session' : 'ready';
    return {
        today,
        status,
        setting,
        cohort,
        units,
        days,
        totalMs: closedDays.reduce((n, d) => n + d.countedMs, 0) + counted.days.reduce((n, d) => n + d.countedMs, 0),
        todayMs: byDay.get(today)?.countedMs ?? 0,
        unitMs: counted.carriedAfterMs,
    };
}

/**
 * @typedef {{ counting: boolean, reason: StudyReason | null, todayMs: number, unit: { unitKey: string, countedMs: number, setMs: number, capReached: boolean } }} SignalState
 */

/**
 * The state in a signal's answer (an accepted signal that is not a stop): today's counted time, the
 * unit's, and why it is not counting (studyReason, null while it counts). null without today's setting.
 * @param {{ nowMs: number, signal: SignalBody, prevAt: number | null, time: ReturnType<typeof liveTime>, signals: Signal[], settings?: Setting[] }} input
 *   prevAt: the chain's previous stored signal (null for its first); signals: the live evidence up to
 *   nowMs; settings: the cohort's (a pair across 00:00 is judged with each day's; default: today's)
 * @returns {SignalState | null}
 */
export function stateAfterSignal({ nowMs, signal, prevAt, time, signals, settings }) {
    const setMs = time.setting?.setMs.get(signal.unitKey);
    if (!time.setting || setMs === undefined) return null;
    const countedMs = time.unitMs.get(signal.unitKey) ?? 0;
    const today = time.setting.rules.counting;
    const reason = studyReason({
        now: nowMs, chain: { id: signal.chainId, unit: signal.unitKey, prevAt }, signal, signals,
        counting: today,
        countingOf: (day) => (settings ? settingOf(settings, day)?.rules.counting ?? null : today),
        maxPlaces: time.setting.rules.collection.maxPlaces,
        setMs, unitMs: countedMs, cohort: time.cohort,
    });
    return { counting: reason === null, reason, todayMs: time.todayMs, unit: { unitKey: signal.unitKey, countedMs, setMs, capReached: countedMs >= setMs } };
}

/**
 * One transaction on its own connection. `work` decides whether to commit. A lock wait over
 * TRAINING_LOCK_TIMEOUT (55P03) is 'account_busy'. `begin`: the live values' read-only snapshot
 * (TRAINING_TIME_SQL.beginRead); a plain BEGIN otherwise.
 * @template T
 * @param {TrainingPool | null | undefined} pool @param {string} operation
 * @param {(client: Queryable) => Promise<{ commit: boolean, value: T }>} work
 * @param {string} [begin]
 * @returns {Promise<T | CoreError>}
 */
async function transaction(pool, operation, work, begin = 'BEGIN') {
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
        await client.query(begin);
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
 * when a setting is already in effect (from tomorrow then), and, once the cohort has evidence, a
 * unit list of another course than the one in effect today.
 * @param {{ cohortSlug: string, catalogSha256: string, rulesSha256: string, effectiveFrom: string, setBy: unknown, reason: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'set', id: string, effectiveFrom: string }
 *   | { status: 'no_cohort' | 'no_dates' | 'no_catalog' | 'no_rules' | 'after_end' }
 *   | { status: 'course_differs', courseKey: string }
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
        await db.query(TRAINING_TIME_SQL.settingsLock, [cohort.id]);
        const catalog = (await db.query(TRAINING_TIME_SQL.catalogBySha, [catalogSha256])).rows?.[0];
        if (!catalog) return refuse({ status: 'no_catalog' });
        const rules = (await db.query(TRAINING_TIME_SQL.rulesBySha, [rulesSha256])).rows?.[0];
        if (!rules) return refuse({ status: 'no_rules' });
        // Early refusals with today read after the lock; the insert decides again with its own clock.
        const today = String((await db.query(TRAINING_TIME_SQL.jstToday)).rows?.[0]?.today);
        if (effectiveFrom < today) return refuse({ status: 'past', today });
        if (effectiveFrom > cohort.ends_on) return refuse({ status: 'after_end' });
        const earlier = (await db.query(TRAINING_TIME_SQL.settingCourses, [cohort.id])).rows ?? [];
        // The setting in effect today (the rows are in the order effective_from, id).
        const current = earlier.filter((s) => String(s.effective_from) <= today).at(-1);
        if (effectiveFrom <= today && current) return refuse({ status: 'in_effect_today', today });
        // Once there is evidence, the course stays the one in effect today: new rules or units for it,
        // or undoing a switch scheduled before the evidence, are fine; another course is not.
        if (current && String(current.course_key) !== String(catalog.course_key)
            && (await db.query(TRAINING_TIME_SQL.cohortHasEvidence, [cohort.id])).rows?.[0]?.evidence) {
            return refuse({ status: 'course_differs', courseKey: String(current.course_key) });
        }
        const row = (await db.query(TRAINING_TIME_SQL.insertSetting, [cohort.id, catalog.id, rules.id, effectiveFrom, by, why])).rows?.[0];
        if (!row?.id) {
            // Midnight passed after the early checks: the insert's own day refused it.
            const day = String(row?.today);
            return refuse({ status: effectiveFrom < day ? 'past' : 'in_effect_today', today: day });
        }
        return { commit: true, value: { status: 'set', id: String(row.id), effectiveFrom: String(row.effective_from) } };
    });
}

/** A stored version that no longer parses with this code stops the counting (no guess). */
const INVALID_SETTING = Object.freeze({ error: 'A stored rules or unit list version does not parse with this code.', error_type: 'invalid_setting' });

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
        await db.query(TRAINING_TIME_SQL.settingsLockShared, [cohortId]);
        /** @param {any} reason */
        const nothing = (reason) => ({ commit: false, value: /** @type {any} */ ({ status: 'nothing', reason }) });
        const state = (await db.query(TRAINING_TIME_SQL.closeState, [userId, cohortId])).rows?.[0];
        if (!state) return nothing('no_cohort');
        if (!state.stub) return nothing('no_account');
        const settings = parseSettings((await db.query(TRAINING_TIME_SQL.closeSettings, [cohortId])).rows ?? []);
        if (!settings) return { commit: false, value: /** @type {any} */ ({ ...INVALID_SETTING }) };
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

/** Who closes days from the API (training_time_days.computed_by; the staff script is 'staff'). */
export const API_CLOSER = 'api';
/** Ignored signals after which the page keeps its chain and sends the next one beatMs later. */
const KEEP_CHAIN = new Set(['duplicate', 'too_soon']);

/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString();

/**
 * The stub is gone: a deletion committed while the request waited on the account lock (its
 * tombstone), or the stub could not be written at sign-in.
 * @param {Queryable} db @param {string} userId
 * @returns {Promise<{ status: 'deleted_account' | 'no_account' }>}
 */
async function noStub(db, userId) {
    const deleted = ((await db.query(TRAINING_SQL.deletedAccount, [userId])).rowCount ?? 0) > 0;
    return { status: deleted ? 'deleted_account' : 'no_account' };
}

/**
 * The live values' reads, in one read-only snapshot (TRAINING_TIME_SQL.beginRead). asOfMs: count
 * the evidence up to this instant (a signal's clock); null: up to the read's own clock.
 * @param {TrainingPool | null | undefined} pool @param {string} operation @param {string} userId @param {string} cohortId
 * @param {number | null} asOfMs
 * @returns {Promise<LiveInput | { gone: 'no_cohort' | 'no_account' | 'not_a_learner' } | CoreError>}
 */
function readLive(pool, operation, userId, cohortId, asOfMs) {
    return transaction(pool, operation, async (db) => {
        /** @param {any} value */
        const done = (value) => ({ commit: true, value });
        const state = (await db.query(TRAINING_TIME_SQL.closeState, [userId, cohortId])).rows?.[0];
        if (!state) return done({ gone: 'no_cohort' });
        if (!state.stub) return done({ gone: 'no_account' });
        if (!state.added_on) return done({ gone: 'not_a_learner' });
        const settings = parseSettings((await db.query(TRAINING_TIME_SQL.closeSettings, [cohortId])).rows ?? []);
        if (!settings) return done({ ...INVALID_SETTING });
        const nowMs = asOfMs ?? Number(state.now_ms);
        const at = { nowMs, startsOn: state.starts_on, endsOn: state.ends_on, addedOn: state.added_on, lastClosed: state.last_closed, settings };
        const unitTotals = new Map(((await db.query(TRAINING_TIME_SQL.unitTotals, [userId, cohortId])).rows ?? []).map((r) => [String(r.unit_key), Number(r.counted_ms)]));
        const closedDays = ((await db.query(TRAINING_TIME_SQL.currentDays, [userId, cohortId])).rows ?? []).map((r) => ({ day: String(r.day), countedMs: Number(r.counted_ms) }));
        const live = liveRange(at)?.live;
        /** @type {Signal[]} */
        let signals = [];
        if (live) {
            const window = closeWindow({ ...live, settings });
            signals = ((await db.query(TRAINING_TIME_SQL.evidence, [userId, cohortId, live.fromDay, live.toDay, iso(window.from), iso(Math.min(window.to, nowMs))])).rows ?? []).map(signalOf);
        }
        return done({ ...at, closedDays, unitTotals, signals });
    }, TRAINING_TIME_SQL.beginRead);
}

/**
 * Store a learner's signal in a cohort (POST .../time/signals; the header): transaction 1 decides
 * with admitSignal and stores an accepted signal; a close follows when a day may have become final;
 * then the state as of the signal's clock (none for a stop, which ends the chain). A failed close or
 * a failed state keeps the signal: closeError or stateError names it (the caller logs it); after a
 * failed state, state is null. The unit is checked in today's stored unit list as stored, so a
 * stored unit list that no longer parses with this code keeps signals (the evidence) while the
 * close and the state fail with invalid_setting; today's rules that no longer parse refuse the
 * signal. nextInMs: beatMs while the page keeps the chain (accepted, duplicate, too_soon, while the
 * cohort is in session and the chain goes on); null otherwise: the page ends it (a stop, the
 * cohort's end) or reacts to the reason (a new chain, or it stops).
 * @param {{ userId: unknown, cohortId: unknown, signal: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'accepted', nextInMs: number | null, state: SignalState | null, closeError?: string, stateError?: string }
 *   | { status: 'ignored', reason: string, nextInMs: number | null }
 *   | { status: 'refused', reason: string }
 *   | { status: 'not_found' | 'not_a_learner' | 'deleted_account' | 'no_account' | 'clock_behind' }
 *   | CoreError>} refused: admitSignal's 409 reasons; not_found: no such cohort, or no live
 *   membership in it; clock_behind: the database clock is not past the last closed day's evidence window
 */
export async function recordSignal({ userId: rawUserId, cohortId: rawCohortId, signal: rawSignal, pool = getPool() }) {
    const userId = canonicalUserId(rawUserId);
    const cohortId = canonicalUserId(rawCohortId);
    const signal = readSignalBody(rawSignal);
    if (!userId || !cohortId || !signal) return { error: 'An account id, a cohort id (UUIDs) and a signal are required.', error_type: 'validation' };
    /** @type {any} */
    const stored = await transaction(pool, 'recordSignal', async (db) => {
        await db.query(TRAINING_SQL.lock, [userId]);
        await db.query(TRAINING_SQL.learnerLock, [userId]);
        await db.query(TRAINING_TIME_SQL.settingsLockShared, [cohortId]);
        /** @param {any} value */
        const nothing = (value) => ({ commit: false, value });
        const row = (await db.query(TRAINING_TIME_SQL.signalState, [userId, cohortId, signal.chainId, signal.unitKey])).rows?.[0];
        if (!row) return nothing({ error: 'The signal state could not be read.', error_type: 'unknown' });
        // The stub first: a deletion that committed while this waited also marked the membership.
        if (!row.stub) return nothing(await noStub(db, userId));
        if (!row.cohort_id || !row.role) return nothing({ status: 'not_found' });
        if (row.role !== 'learner') return nothing({ status: 'not_a_learner' });
        if (row.params === null || row.params === undefined) return nothing({ status: 'refused', reason: 'time_not_configured' });
        const parsed = parseTimeRules(row.params);
        if ('errors' in parsed) return nothing({ ...INVALID_SETTING });
        const { rules } = parsed;
        const nowMs = Number(row.now_ms);
        const chain = row.chain_seq === null || row.chain_seq === undefined ? null : {
            cohortId: String(row.chain_cohort_id), unitKey: String(row.chain_unit_key), bornAt: Number(row.chain_born),
            lastSeq: Number(row.chain_seq), lastAt: Number(row.chain_at), lastStop: (Number(row.chain_flags) & SIGNAL_FLAGS.stop) !== 0,
        };
        const places = (Array.isArray(row.places) ? row.places : []).map((/** @type {any} */ p) => ({
            chainId: String(p.chain_id), bornAt: Number(p.born), lastAt: Number(p.at), lastStop: (Number(p.flags) & SIGNAL_FLAGS.stop) !== 0,
        }));
        const session = cohortRange(row.starts_on, row.ends_on);
        const verdict = admitSignal({ now: nowMs, cohortId, signal, configured: true, session, unitKnown: row.unit_known === true, chain, places, rules });
        // The page keeps the chain while the cohort is in session and the chain goes on (not a stop,
        // and not after one); after the cohort's last day a known chain's signal only closes its pair.
        const keeps = !signal.stop && !chain?.lastStop && session !== null && nowMs < session.to;
        const nextInMs = keeps ? rules.collection.beatMs : null;
        if (verdict.verdict !== 'accept') {
            if (verdict.verdict === 'refuse') return nothing({ status: 'refused', reason: verdict.reason });
            return nothing({ status: 'ignored', reason: verdict.reason, nextInMs: KEEP_CHAIN.has(verdict.reason) ? nextInMs : null });
        }
        // A clock that went back into a closed day's evidence window would change that day's evidence.
        if (row.closed_until_ms !== null && row.closed_until_ms !== undefined && nowMs <= Number(row.closed_until_ms)) return nothing({ status: 'clock_behind' });
        const at = iso(nowMs);
        await db.query(TRAINING_TIME_SQL.insertStream, [userId, cohortId, signal.unitKey, signal.chainId, iso(verdict.bornAt), at]);
        const inserted = (await db.query(TRAINING_TIME_SQL.insertSignal, [userId, signal.chainId, at, signal.seq, flagsOf(signal)])).rows ?? [];
        // Under the learner's lock no other signal of the account is written (admitSignal saw the
        // chain's last seq), and under the account lock the stub stays: anything else is a fault.
        if (inserted.length !== 1) return nothing({ error: 'The signal could not be written.', error_type: 'unknown' });
        const yesterdayGapMs = row.yesterday_gap_ms === null || row.yesterday_gap_ms === undefined ? null : Number(row.yesterday_gap_ms);
        const due = closeDue({ nowMs, startsOn: row.starts_on, endsOn: row.ends_on, addedOn: row.added_on, firstSetting: row.first_setting, lastClosed: row.last_closed, yesterdayGapMs });
        return { commit: true, value: { status: 'accepted', nowMs, nextInMs, prevAt: chain ? chain.lastAt : null, due } };
    });
    if ('error_type' in stored || stored.status !== 'accepted') return stored;
    /** @type {{ status: 'accepted', nextInMs: number | null, state: SignalState | null, closeError?: string, stateError?: string }} */
    const answer = { status: 'accepted', nextInMs: stored.nextInMs, state: null };
    if (stored.due) {
        const closed = await closeDays({ userId, cohortId, computedBy: API_CLOSER, pool });
        if ('error_type' in closed) answer.closeError = closed.error_type;
    }
    if (signal.stop) return answer;
    const read = await readLive(pool, 'studyTimeState', userId, cohortId, stored.nowMs);
    if ('error_type' in read) return { ...answer, stateError: read.error_type };
    // A deletion that committed after the signal: no state.
    if ('gone' in read) return answer;
    try {
        answer.state = stateAfterSignal({ nowMs: stored.nowMs, signal, prevAt: stored.prevAt, time: liveTime(read), signals: read.signals, settings: read.settings });
    } catch (err) {
        return { ...answer, stateError: classifyDbError(/** @type {any} */ (err), 'studyTimeState').error_type };
    }
    return answer;
}

/**
 * @typedef {{ learnerId: string, cohortId: string, today: string, timeZone: 'Asia/Tokyo', status: 'ready' | 'not_configured' | 'not_in_session',
 *   beatMs?: number, units: LiveUnit[], days: LiveDay[], totalMs: number, asOf: string }} StudyTime
 */

/**
 * A learner's study time in a cohort (GET .../time), only for a live learner membership: the final
 * days are closed first (closeDays), then the live values are read in one read-only snapshot.
 * beatMs only while the cohort is in session (the page's beat; no other rule value).
 * @param {{ userId: unknown, cohortId: unknown, pool?: TrainingPool | null }} params
 * @returns {Promise<{ status: 'read', time: StudyTime } | { status: 'not_found' | 'not_a_learner' | 'deleted_account' | 'no_account' } | CoreError>}
 *   not_found: no such cohort, or no live membership in it (the two are not told apart)
 */
export async function readStudyTime({ userId: rawUserId, cohortId: rawCohortId, pool = getPool() }) {
    const userId = canonicalUserId(rawUserId);
    const cohortId = canonicalUserId(rawCohortId);
    if (!userId || !cohortId) return { error: 'An account id and a cohort id (UUIDs) are required.', error_type: 'validation' };
    if (!pool) return noDatabase();
    try {
        // The role first: closing reads every setting under the learner's lock, for learners only.
        const role = (await pool.query(TRAINING_SQL.liveMember, [userId, cohortId])).rows?.[0]?.role;
        if (!role) return { status: 'not_found' };
        if (role !== 'learner') return { status: 'not_a_learner' };
        const closed = await closeDays({ userId, cohortId, computedBy: API_CLOSER, pool });
        if ('error_type' in closed) return closed;
        if (closed.status === 'nothing' && closed.reason === 'no_account') return await noStub(pool, userId);
        const read = await readLive(pool, 'readStudyTime', userId, cohortId, null);
        if ('error_type' in read) return read;
        if ('gone' in read) return read.gone === 'no_account' ? await noStub(pool, userId) : { status: 'not_found' };
        const time = liveTime(read);
        return {
            status: 'read',
            time: {
                learnerId: userId,
                cohortId,
                today: time.today,
                timeZone: 'Asia/Tokyo',
                status: time.status,
                ...(time.status === 'ready' && time.setting ? { beatMs: time.setting.rules.collection.beatMs } : {}),
                units: time.units,
                days: time.days,
                totalMs: time.totalMs,
                asOf: iso(read.nowMs),
            },
        };
    } catch (err) {
        return classifyDbError(/** @type {any} */ (err), 'readStudyTime');
    }
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
