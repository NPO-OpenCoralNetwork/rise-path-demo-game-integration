#!/usr/bin/env node
// @ts-check
/**
 * Proves migration 022 (job training: study time records) and the code that uses it
 * (tools/core/trainingTime.js, the membership add of tools/core/training.js, the deletion's two
 * marks) on a real, THROWAWAY PostgreSQL (16, as the VM's pgvector/pgvector:0.8.7-pg16). npm test
 * pins the SQL text (server/tests/migration022.test.js) and runs the code on an in-memory fake
 * (server/tests/trainingTimeCore.test.js); CI runs this script on the VM's image (job "Database
 * checks", scripts/ci/db-checks.sh). It is the 確かめ方 of server/migrations/README.md for 022.
 *
 *   createdb -h 127.0.0.1 -p 55622 -U postgres verify_tr
 *   node scripts/db/verify-training.mjs --url postgres://postgres@127.0.0.1:55622/verify_tr
 *
 * Same refusals and exit codes as verify-account-deletion.mjs (whose parseArgs and exitCode it
 * uses): exit 2 unless the database has no table in public or auth, the role risepath_mcp_remote
 * does not exist in the cluster, and the user is a superuser; 1 when a check failed. No check is
 * skipped. The database keeps the test rows: drop it afterwards. Every rule value is artificial.
 *
 * Checks (doc/brushup-2026/training-plan.ja.md §4.9):
 *   M   every migration twice, each in its own transaction
 *   T1  the tables: a stream's day is its first signal's Japan-time day (at 15:00Z); one live stream
 *       per learner, chain and day, again after the mark (a re-opened id); one close per learner,
 *       cohort and day (the core's insertDays) with a recount beside it, the newest live row the
 *       current value; the flag, sequence and per-day CHECKs
 *   T2  configuration through the core: a unit list and rules load once (the stored jsonb gives the
 *       stored sha256 again), the settings: from today, today again refused, tomorrow, a past day
 *       refused (by the script's check and by the CHECK); the insert alone refuses today and a past
 *       day with its own clock reading (no 23514) and answers today; the three settings tables
 *       refuse UPDATE and DELETE (23001); two settings of one cohort at once: one set, one refused
 *       (the settings lock); a close waits for a setting in progress
 *   T3  closing through the core equals the pure function (shared/training/studyTime.js) on the same
 *       signals: three days with a chain across 00:00 JST, a unit's set time reached, other rules
 *       and units from the third day (each day's version ids), a zero day; the digest and count of
 *       each day's evidence; a second close closes nothing; a recount row becomes the current value.
 *       Day by day: a close after an earlier close carries the unit's time from the closed day's
 *       newest live row (a recount too) and reads the evidence before 00:00
 *   T4  two closes of one learner at once (both waiting on the learner lock): one closes, the other
 *       finds nothing; one row per day
 *   T5  closing against an account deletion, both orders: deletion first, the close waits for the
 *       account lock and writes nothing (no stub); close first, the deletion service waits, then
 *       marks the new day rows with the tombstone's time; control: the day insert without the
 *       account lock leaves a live row for a deleted account
 *   T6  a re-opened account: added again through the real add (the marked membership overlaps
 *       nothing); its marked evidence is not counted and its marked day (a unit's whole set time)
 *       is not carried: new study on that unit has the set time again
 *   T7  two adds of one learner into cohorts whose dates overlap, at once: one added, one refused
 *       (overlapping); control: without the learner lock both are added
 *   T8  Japan-time days and whole milliseconds: SQL and JavaScript agree around 15:00Z
 * The checks compare Japan-time days read at different moments: like db-checks.sh before all the
 * verify scripts, the script first waits past 00:00 JST when less than a minute is left.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { exitCode, parseArgs } from './verify-account-deletion.mjs';
import { waitPastJstMidnight } from '../ci/jst-midnight-guard.mjs';
import { deleteAccountData, SQL as DELETION_SQL } from '../../server/services/accountDeletion.js';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { setMsOf } from '../../shared/training/courseManifest.js';
import { cohortRange, countDays, evidenceWindow, jstDayOf, jstDayRange, nextDay } from '../../shared/training/studyTime.js';
import { parseTimeRules } from '../../shared/training/timeRules.js';
import { accountLockKey, reopenAccount } from '../../tools/core/accountDeletions.js';
import { TRAINING_SQL, addMember } from '../../tools/core/training.js';
import { TRAINING_TIME_SQL, closeDays, evidenceDigest, learnerDays, loadCatalog, loadRules, setCohortTime } from '../../tools/core/trainingTime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(ROOT, 'server', 'migrations');
const FILE = '022_training_study_time.sql';
const ROLE = 'risepath_mcp_remote';
const HOLD_MS = 2000;
const LEAD_MS = 600;
/** A waiter counts as blocked when it waited at least this long. */
const BLOCKED_MS = HOLD_MS - LEAD_MS - 400;
const S = 1000;
// Artificial rules and units (not the school's: training-plan D9).
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7 * S, minSpacingMs: 3 * S, maxPlaces: 3 },
    counting: { gapMs: 23 * S, creditCapMs: 13 * S, idleMs: 101 * S, requireFocus: false, overlap: 'prefer_focus_latest' },
});
const RULES = /** @type {any} */ (parseTimeRules(RULES_IN)).rules;
const RULES_IN_2 = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 5 * S } });
const RULES_2 = /** @type {any} */ (parseTimeRules(RULES_IN_2)).rules;
const unitsOf = (/** @type {number} */ u1, /** @type {number} */ u2) => ({
    schema: 'risepath.training-course/v1',
    courseKey: 'verify-course',
    title: { jp: '確かめ用', en: 'Verify' },
    units: [{ key: 'unit-a', title: { jp: 'A', en: 'A' }, setMinutes: u1 }, { key: 'unit-b', title: { jp: 'B', en: 'B' }, setMinutes: u2 }],
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
const sha256 = (/** @type {string} */ text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
let counter = 0;
/** A fresh UUID per test row, with letters in it (so its upper-case form differs). @param {string} tag */
const uid = (tag) => {
    counter += 1;
    const n = counter.toString(16).padStart(4, '0');
    const hex = (Buffer.from(tag).toString('hex') + n).padEnd(12, '0').slice(-12);
    return `bcde${n}-0000-4000-8000-${hex}`;
};

/** @type {{ id: string, ok: boolean }[]} */
const results = [];
/** @param {string} id @param {boolean} ok @param {string} label */
function check(id, ok, label) {
    results.push({ id, ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(3)} ${label}`);
}

/** @param {pg.Pool} pool @param {string} sql @param {unknown[]} [params] */
const count = async (pool, sql, params = []) => Number((await pool.query(sql, params)).rows[0]?.n ?? NaN);
/** The SQLSTATE of a statement, or 'ok'. @param {pg.Pool} pool @param {string} sql @param {unknown[]} [params] */
const codeOf = async (pool, sql, params = []) => {
    try {
        await pool.query(sql, params);
        return 'ok';
    } catch (error) {
        return String(/** @type {any} */ (error).code);
    }
};

/** @param {pg.Pool} pool @param {string} file */
async function applyMigration(pool, file) {
    const sql = await fs.readFile(path.join(MIGRATIONS, file), 'utf8');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${file}: ${/** @type {Error} */ (error).message}`);
    } finally {
        client.release();
    }
}

/** Japan-time day `n` days from the database's today. @param {pg.Pool} pool @param {number} n */
const dayFromToday = async (pool, n) => String((await pool.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date + $1::int, 'YYYY-MM-DD') AS d`, [n])).rows[0].d);

/**
 * A cohort with dates, a learner added on a given day and a setting row (inserted directly, so a
 * past day is possible: set_at is given).
 * @param {pg.Pool} pool @param {{ startsOn: string, endsOn: string, catalogId: string, ruleSetId: string, from: string, learners?: string[], addedOn?: string }} c
 */
async function cohortWith(pool, { startsOn, endsOn, catalogId, ruleSetId, from, learners = [], addedOn = startsOn }) {
    const id = uid('coh');
    await pool.query('INSERT INTO training_cohorts (id, slug, name, starts_on, ends_on) VALUES ($1, $2, $3, $4::date, $5::date)', [id, `v-${id.slice(4, 8)}-${counter}`, 'verify', startsOn, endsOn]);
    await pool.query("INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_at, set_by, reason) VALUES ($1, $2, $3, $4::date, $5::timestamptz, 'verify', 'verify')",
        [id, catalogId, ruleSetId, from, iso(jstDayRange(from).start - 86_400_000)]);
    for (const learner of learners) {
        await pool.query('INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT (id) DO NOTHING', [learner]);
        await pool.query("INSERT INTO training_memberships (cohort_id, user_id, role, added_at) VALUES ($1, $2, 'learner', $3::timestamptz)", [id, learner, iso(jstDayRange(addedOn).start + 3_600_000)]);
    }
    return id;
}

/**
 * One page's chain stored as the write path of part 2b stores it: a stream row for each Japan-time
 * day of its signals (made by the first signal of that day), then a narrow row per signal; `n`
 * signals `every` ms apart, each with input and focus. Returns them as the counting reads them.
 * @param {pg.Pool} pool @param {{ user: string, cohort: string, unit: string, from: number, n: number, every?: number }} c
 */
async function storeChain(pool, { user, cohort, unit, from, n, every = 7 * S }) {
    const chain = uid('chn');
    /** @type {import('../../shared/training/studyTime.js').Signal[]} */
    const out = [];
    /** @type {Map<string, string>} */
    const streams = new Map();
    for (let seq = 0; seq < n; seq += 1) {
        const at = from + seq * every;
        const day = jstDayOf(at);
        if (!streams.has(day)) {
            const row = (await pool.query(`INSERT INTO training_time_streams (user_id, cohort_id, unit_key, chain_id, chain_started_at, day, started_at)
                VALUES ($1, $2, $3, $4, $5::timestamptz, $6::date, $7::timestamptz) RETURNING id`, [user, cohort, unit, chain, iso(from), day, iso(at)])).rows[0];
            streams.set(day, String(row.id));
        }
        await pool.query('INSERT INTO training_time_signals (stream_id, received_at, seq, flags) VALUES ($1, $2::timestamptz, $3, 6)', [streams.get(day), iso(at), seq]);
        out.push({ chain, seq, unit, born: from, at, stop: false, focus: true, input: true });
    }
    return out;
}

/** The core's close (staff). @param {pg.Pool} pool @param {string} user @param {string} cohort */
const close = (pool, user, cohort) => closeDays({ userId: user, cohortId: cohort, computedBy: 'verify', pool });
/** @param {pg.Pool} pool @param {string} user @param {string} cohort */
const dayRows = async (pool, user, cohort) => (await pool.query(`SELECT id, to_char(day, 'YYYY-MM-DD') AS day, kind, counted_ms, over_cap_ms, signals, evidence_sha256, rule_set_id, catalog_version_id, account_deleted_at
    FROM training_time_days WHERE user_id = $1 AND cohort_id = $2 ORDER BY day, id`, [user, cohort])).rows;

/** The deletion's own statements up to the stub, as the service sends them, without COMMIT. @param {pg.PoolClient} c @param {string} id */
async function deletionUpToStub(c, id) {
    await c.query('BEGIN');
    await c.query(`SELECT pg_advisory_xact_lock(${accountLockKey(1)})`, [id]);
    await c.query(DELETION_SQL.writeTombstone, [id, 'staff']);
    await c.query(DELETION_SQL.markTrainingMemberships, [id]);
    await c.query(DELETION_SQL.markTrainingTimeStreams, [id]);
    await c.query(DELETION_SQL.markTrainingTimeDays, [id]);
    await c.query(DELETION_SQL.deleteStub, [id]);
}

/** @param {pg.Pool} pool */
async function t1(pool, { catalogId, ruleSetId }) {
    const today = await dayFromToday(pool, 0);
    const cohort = await cohortWith(pool, { startsOn: today, endsOn: today, catalogId, ruleSetId, from: today });
    const user = uid('t1u');
    const stream = (chain, day, at) => codeOf(pool, 'INSERT INTO training_time_streams (user_id, cohort_id, unit_key, chain_id, chain_started_at, day, started_at) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::date, $5::timestamptz)',
        [user, cohort, 'unit-a', chain, at, day]);
    const day = [await stream(uid('c'), '2026-11-04', '2026-11-04T14:59:59.999Z'), await stream(uid('c'), '2026-11-05', '2026-11-04T14:59:59.999Z'), await stream(uid('c'), '2026-11-05', '2026-11-04T15:00:00Z')];
    check('T1', day.join() === 'ok,23514,ok', `a stream's day is its first signal's Japan-time day: 14:59:59.999Z on 11-04 ${day[0]}, on 11-05 ${day[1]}, 15:00Z on 11-05 ${day[2]}`);

    const chain = uid('c');
    const first = await stream(chain, '2026-10-01', '2026-10-01T01:00:00Z');
    const twice = await stream(chain, '2026-10-01', '2026-10-01T01:00:00Z');
    await pool.query('UPDATE training_time_streams SET account_deleted_at = now() WHERE user_id = $1 AND chain_id = $2', [user, chain]);
    const reopened = await stream(chain, '2026-10-01', '2026-10-01T01:00:00Z');
    check('T1', [first, twice, reopened].join() === 'ok,23505,ok', `one live stream per learner, chain and day: ${first}, again ${twice}; after the mark (a re-opened id) ${reopened}`);

    const streamId = (await pool.query('SELECT id FROM training_time_streams WHERE user_id = $1 AND account_deleted_at IS NULL LIMIT 1', [user])).rows[0].id;
    const signal = (seq, flags) => codeOf(pool, "INSERT INTO training_time_signals (stream_id, received_at, seq, flags) VALUES ($1, '2026-10-01T01:00:00Z', $2, $3)", [streamId, seq, flags]);
    const flags = [await signal(0, 7), await signal(1, 8), await signal(-1, 0), await signal(0, 1)];
    check('T1', flags.join() === 'ok,23514,23514,23505', `signals: flags 7 ${flags[0]}, flags 8 ${flags[1]}, seq -1 ${flags[2]}, the same seq again ${flags[3]}`);

    await pool.query('INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT (id) DO NOTHING', [user]);
    const insertDay = async (counted) => (await pool.query(TRAINING_TIME_SQL.insertDays, [user, cohort, 'verify', ['2026-10-01'], ['study-time/v1'], [ruleSetId], [catalogId], [counted], [0], [0], ['b'.repeat(64)]])).rowCount;
    const closes = [await insertDay(1000), await insertDay(2000)];
    await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by)
        VALUES ($1, $2, '2026-10-01', 'recompute', 'study-time/v1', $3, $4, 3000, 0, 0, repeat('c', 64), 'verify')`, [user, cohort, ruleSetId, catalogId]);
    const current = (await pool.query(TRAINING_TIME_SQL.currentDays, [user, cohort])).rows.map((r) => `${r.day}:${r.kind}:${r.counted_ms}`);
    check('T1', closes.join() === '1,0' && current.join() === '2026-10-01:recompute:3000', `one close per learner, cohort and day (the core's insert: ${closes.join(', ')}); a recount beside it is the current value: ${current.join()}`);

    const dayCheck = (counted, over) => codeOf(pool, `INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by)
        VALUES ($1, $2, '2026-10-02', 'recompute', 'study-time/v1', $3, $4, $5, $6, 0, repeat('d', 64), 'verify')`, [user, cohort, ruleSetId, catalogId, counted, over]);
    const dayId = (await pool.query("SELECT id FROM training_time_days WHERE user_id = $1 AND kind = 'close'", [user])).rows[0].id;
    const unitZero = await codeOf(pool, "INSERT INTO training_time_unit_days (day_id, unit_key, counted_ms, over_cap_ms) VALUES ($1, 'unit-a', 0, 0)", [dayId]);
    const limits = [await dayCheck(86_400_000, 1), await dayCheck(86_400_000, 0), unitZero];
    check('T1', limits.join() === '23514,ok,23514', `a day holds at most 24 hours (counted + over: ${limits[0]}, exactly 24 h: ${limits[1]}); a unit row with no time ${limits[2]}`);
}

/** @param {pg.Pool} pool */
async function t2(pool) {
    const course = unitsOf(2, 30);
    const loaded = /** @type {any} */ (await loadCatalog({ input: course, loadedBy: 'verify', note: 'T2', pool }));
    const again = /** @type {any} */ (await loadCatalog({ input: JSON.parse(JSON.stringify({ units: course.units, title: course.title, courseKey: course.courseKey, schema: course.schema })), loadedBy: 'x', note: 'y', pool }));
    const stored = (await pool.query('SELECT sha256, manifest FROM training_catalog_versions WHERE id = $1', [loaded.id])).rows[0];
    check('T2', loaded.status === 'loaded' && again.status === 'exists' && again.id === loaded.id && stored.sha256 === sha256(canonicalJson(stored.manifest)),
        `a unit list loads once (${loaded.status}, then ${again.status} as version ${again.id}); the stored jsonb gives the stored sha256 again`);
    const rules = /** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'verify', note: 'T2', pool }));
    const rulesAgain = /** @type {any} */ (await loadRules({ input: JSON.parse(JSON.stringify(RULES_IN)), loadedBy: 'x', note: 'y', pool }));
    const storedRules = (await pool.query('SELECT sha256, params FROM training_time_rule_sets WHERE id = $1', [rules.id])).rows[0];
    check('T2', rules.status === 'loaded' && rulesAgain.status === 'exists' && storedRules.sha256 === sha256(canonicalJson(storedRules.params)) && storedRules.sha256 === rules.sha256,
        `rules load once (${rules.status}, then ${rulesAgain.status}); the stored jsonb gives the stored sha256 again`);

    const today = await dayFromToday(pool, 0);
    const tomorrow = await dayFromToday(pool, 1);
    const yesterday = await dayFromToday(pool, -1);
    const slug = `t2-${uid('s').slice(4, 8)}`;
    await pool.query('INSERT INTO training_cohorts (slug, name, starts_on, ends_on) VALUES ($1, $2, $3::date, $4::date)', [slug, 'T2', yesterday, await dayFromToday(pool, 30)]);
    const set = (from) => setCohortTime({ cohortSlug: slug, catalogSha256: loaded.sha256, rulesSha256: rules.sha256, effectiveFrom: from, setBy: 'verify', reason: 'T2', pool });
    const outcomes = [await set(today), await set(today), await set(tomorrow), await set(yesterday)].map((r) => /** @type {any} */ (r).status ?? /** @type {any} */ (r).error_type);
    const cohortId = (await pool.query('SELECT id FROM training_cohorts WHERE slug = $1', [slug])).rows[0].id;
    const direct = await codeOf(pool, "INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_by, reason) VALUES ($1, $2, $3, $4::date, 'x', 'y')", [cohortId, loaded.id, rules.id, yesterday]);
    check('T2', outcomes.join() === 'set,in_effect_today,set,past' && direct === '23514',
        `settings: today ${outcomes[0]}, today again ${outcomes[1]}, tomorrow ${outcomes[2]}, yesterday ${outcomes[3]}; yesterday inserted directly ${direct} (the CHECK)`);

    const changes = [
        await codeOf(pool, 'UPDATE training_catalog_versions SET note = $2 WHERE id = $1', [loaded.id, 'x']),
        await codeOf(pool, 'DELETE FROM training_time_rule_sets WHERE id = $1', [rules.id]),
        await codeOf(pool, "UPDATE training_cohort_time_settings SET reason = 'x' WHERE cohort_id = $1", [cohortId]),
        await codeOf(pool, 'DELETE FROM training_cohort_time_settings WHERE cohort_id = $1', [cohortId]),
    ];
    check('T2', changes.every((c) => c === '23001'), `the settings tables never change (rp_rows_immutable): ${changes.join(', ')}`);

    // The insert alone decides with its own clock reading (the early checks aside): a setting is in
    // effect today, so today is refused and so is yesterday (no 23514: the rule and set_at share the reading).
    const direct2 = async (/** @type {string} */ from) => (await pool.query(TRAINING_TIME_SQL.insertSetting, [cohortId, loaded.id, rules.id, from, 'verify', 'T2 direct'])).rows[0];
    const [onToday, onYesterday, later] = [await direct2(today), await direct2(yesterday), await direct2(await dayFromToday(pool, 2))];
    const laterSetAt = (await pool.query("SELECT to_char((set_at AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS d FROM training_cohort_time_settings WHERE id = $1", [later.id])).rows[0]?.d;
    check('T2', onToday.id === null && onYesterday.id === null && later.id !== null && [onToday.today, onYesterday.today, later.today, laterSetAt].every((d) => d === today),
        `the insert's own rule: today ${onToday.id ?? 'refused'}, yesterday ${onYesterday.id ?? 'refused'}, in 2 days ${later.id ? 'set' : 'refused'}; today ${onToday.today}, set_at on ${laterSetAt}`);

    // Two settings of one cohort at once (both from today, none in effect yet): the settings lock lets
    // one through; the other then sees it in effect and is refused.
    const slug2 = `t2b-${uid('s').slice(4, 8)}`;
    await pool.query('INSERT INTO training_cohorts (slug, name, starts_on, ends_on) VALUES ($1, $2, $3::date, $4::date)', [slug2, 'T2b', yesterday, await dayFromToday(pool, 30)]);
    const cohort2 = (await pool.query('SELECT id FROM training_cohorts WHERE slug = $1', [slug2])).rows[0].id;
    const holder = await pool.connect();
    try {
        await holder.query('BEGIN');
        await holder.query(TRAINING_TIME_SQL.settingsLock, [cohort2]);
        const both = Promise.all([0, 1].map(() => setCohortTime({ cohortSlug: slug2, catalogSha256: loaded.sha256, rulesSha256: rules.sha256, effectiveFrom: today, setBy: 'verify', reason: 'T2b', pool })));
        await sleep(LEAD_MS);
        await holder.query('COMMIT');
        const statuses = (await both).map((r) => /** @type {any} */ (r).status ?? /** @type {any} */ (r).error_type).sort();
        const rows2 = await count(pool, 'SELECT count(*) AS n FROM training_cohort_time_settings WHERE cohort_id = $1', [cohort2]);
        check('T2', statuses.join() === 'in_effect_today,set' && rows2 === 1, `two settings from today at once: ${statuses.join(', ')}; ${rows2} row`);
    } finally {
        holder.release();
    }

    // A close waits for a setting in progress (it takes the settings lock shared before its clock).
    const setter = await pool.connect();
    try {
        await setter.query('BEGIN');
        await setter.query(TRAINING_TIME_SQL.settingsLock, [cohortId]);
        const hold = setter.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]);
        await sleep(LEAD_MS);
        const t0 = Date.now();
        const closing = close(pool, uid('t2c'), cohortId).then((r) => ({ r: /** @type {any} */ (r), waited: Date.now() - t0 }));
        await hold;
        await setter.query('COMMIT');
        const { r, waited } = await closing;
        check('T2', waited >= BLOCKED_MS && r.status === 'nothing', `a close waited ${waited} ms for a setting in progress (then ${r.status ?? r.error_type})`);
    } finally {
        setter.release();
    }
    return { catalogId: String(loaded.id), ruleSetId: String(rules.id) };
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t3(pool, { catalogId, ruleSetId }) {
    const [d1, d2, d3] = [await dayFromToday(pool, -5), await dayFromToday(pool, -4), await dayFromToday(pool, -3)];
    const wider = /** @type {any} */ (await loadCatalog({ input: unitsOf(600, 600), loadedBy: 'verify', note: 'T3', pool }));
    // From the third day, other units' set times and other rules (smaller pieces): a day is counted and recorded with its own setting.
    const rules2 = /** @type {any} */ (await loadRules({ input: RULES_IN_2, loadedBy: 'verify', note: 'T3', pool }));
    const user = uid('t3u');
    const cohort = await cohortWith(pool, { startsOn: d1, endsOn: d3, catalogId, ruleSetId, from: d1, learners: [user], addedOn: d1 });
    await pool.query("INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_at, set_by, reason) VALUES ($1, $2, $3, $4::date, $5::timestamptz, 'verify', 'T3')",
        [cohort, wider.id, rules2.id, d3, iso(jstDayRange(d1).start)]);
    const start = (/** @type {string} */ day) => jstDayRange(day).start;
    const signals = [
        ...await storeChain(pool, { user, cohort, unit: 'unit-a', from: start(d1) + 10 * 3_600_000, n: 20 }),
        ...await storeChain(pool, { user, cohort, unit: 'unit-b', from: start(d2) - 60 * S, n: 20 }),
        ...await storeChain(pool, { user, cohort, unit: 'unit-a', from: start(d3) + 9 * 3_600_000, n: 20 }),
    ];
    const result = /** @type {any} */ (await close(pool, user, cohort));
    const rows = await dayRows(pool, user, cohort);
    const settingOfDay = (/** @type {string} */ day) => (day >= d3
        ? { setMs: setMsOf(unitsOf(600, 600)), catalog: String(wider.id), rules: RULES_2, ruleSet: String(rules2.id) }
        : { setMs: setMsOf(unitsOf(2, 30)), catalog: catalogId, rules: RULES, ruleSet: ruleSetId });
    const want = countDays({ fromDay: d1, toDay: d3, signals, rulesOf: (day) => settingOfDay(day).rules, setMsOf: (day) => settingOfDay(day).setMs, carriedMs: new Map(), cohort: cohortRange(d1, d3) }).days;
    const units = async (/** @type {string} */ dayId) => (await pool.query('SELECT unit_key AS unit, counted_ms AS "countedMs", over_cap_ms AS "overCapMs" FROM training_time_unit_days WHERE day_id = $1 ORDER BY unit_key', [dayId])).rows;
    let same = result.status === 'closed' && rows.length === 3;
    const shown = [];
    for (const [i, row] of rows.entries()) {
        const w = evidenceWindow(start(row.day), jstDayRange(row.day).end, settingOfDay(row.day).rules.counting);
        const evidence = signals.filter((s) => s.at >= w.from && s.at <= w.to);
        same &&= row.counted_ms === want[i]?.countedMs && row.over_cap_ms === want[i].units.reduce((n, u) => n + u.overCapMs, 0)
            && row.signals === evidence.length && row.evidence_sha256 === evidenceDigest(evidence)
            && String(row.catalog_version_id) === settingOfDay(row.day).catalog && String(row.rule_set_id) === settingOfDay(row.day).ruleSet
            && JSON.stringify(await units(row.id)) === JSON.stringify(want[i].units);
        shown.push(`${row.day.slice(5)} ${row.counted_ms / S}+${row.over_cap_ms / S} s`);
    }
    check('T3', same && rows[0].over_cap_ms > 0 && rows[1].counted_ms > 0 && rows[2].counted_ms === 19 * 5 * S,
        `the close equals the pure function on the same signals, day by day and unit by unit (each day's rules, units and version ids, a unit's set time reached, a chain across 00:00 JST, digests): ${shown.join(', ')}`);
    const zeroCohort = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1, learners: [user], addedOn: d1 });
    const zero = /** @type {any} */ (await close(pool, user, zeroCohort));
    const zeroRows = await dayRows(pool, user, zeroCohort);
    check('T3', zero.status === 'closed' && zeroRows.length === 2 && zeroRows.every((r) => r.counted_ms === 0 && r.evidence_sha256 === sha256('[]')), `days without signals are closed as zero days: ${zeroRows.length}`);

    const again = /** @type {any} */ (await close(pool, user, cohort));
    await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by)
        VALUES ($1, $2, $3::date, 'recompute', 'study-time/v1', $4, $5, 1000, 0, 0, repeat('e', 64), 'verify')`, [user, cohort, d2, ruleSetId, catalogId]);
    const read = /** @type {any} */ (await learnerDays({ userId: user, cohortId: cohort, pool }));
    const d2Now = read.days?.find((/** @type {any} */ d) => d.day === d2);
    check('T3', again.status === 'nothing' && again.reason === 'nothing_final' && d2Now?.kind === 'recompute' && d2Now.countedMs === 1000,
        `a second close closes nothing (${again.reason}); a recount row becomes the current value (${d2Now?.kind} ${d2Now?.countedMs} ms)`);

    // Day by day, as the closes run: day 1 closed alone (the cohort ends on it), then day 2 (its last
    // day moved on). A chain runs across 00:00 JST and unit-a reaches its set time on day 1, so day 2
    // needs the unit's time carried from day 1's newest live row and the evidence before 00:00. Two
    // learners with the same signals: one against one continuous count, one after a recount of day 1.
    const [s1, s2] = [await dayFromToday(pool, -3), await dayFromToday(pool, -2)];
    const [steady, recounted] = [uid('t3s'), uid('t3r')];
    const split = await cohortWith(pool, { startsOn: s1, endsOn: s1, catalogId, ruleSetId, from: s1, learners: [steady, recounted] });
    /** @type {Record<string, import('../../shared/training/studyTime.js').Signal[]>} */
    const splitSignals = {};
    const firsts = [];
    for (const learner of [steady, recounted]) {
        splitSignals[learner] = [
            ...await storeChain(pool, { user: learner, cohort: split, unit: 'unit-a', from: start(s1) + 10 * 3_600_000, n: 12 }),
            ...await storeChain(pool, { user: learner, cohort: split, unit: 'unit-a', from: start(s2) - 100 * S, n: 25 }),
        ];
        firsts.push(/** @type {any} */ (await close(pool, learner, split)).toDay);
    }
    const recount = (await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by)
        VALUES ($1, $2, $3::date, 'recompute', 'study-time/v1', $4, $5, 60000, 0, 0, repeat('a', 64), 'verify') RETURNING id`, [recounted, split, s1, ruleSetId, catalogId])).rows[0].id;
    await pool.query("INSERT INTO training_time_unit_days (day_id, unit_key, counted_ms, over_cap_ms) VALUES ($1, 'unit-a', 60000, 0)", [recount]);
    await pool.query('UPDATE training_cohorts SET ends_on = $2::date WHERE id = $1', [split, s2]);
    const seconds = [];
    const splitWant = {
        [steady]: countDays({ fromDay: s1, toDay: s2, signals: splitSignals[steady], rulesOf: () => RULES, setMsOf: () => setMsOf(unitsOf(2, 30)), carriedMs: new Map(), cohort: cohortRange(s1, s2) }).days[1],
        [recounted]: countDays({ fromDay: s2, toDay: s2, signals: splitSignals[recounted], rulesOf: () => RULES, setMsOf: () => setMsOf(unitsOf(2, 30)), carriedMs: new Map([['unit-a', 60000]]), cohort: cohortRange(s1, s2) }).days[0],
    };
    let splitSame = firsts.every((d) => d === s1);
    for (const learner of [steady, recounted]) {
        seconds.push(/** @type {any} */ (await close(pool, learner, split)).fromDay);
        const row = (await dayRows(pool, learner, split)).find((r) => r.day === s2 && r.kind === 'close');
        const want = splitWant[learner];
        splitSame &&= Boolean(row) && row.counted_ms === want.countedMs && row.over_cap_ms === want.units.reduce((n, u) => n + u.overCapMs, 0)
            && JSON.stringify(await units(row.id)) === JSON.stringify(want.units);
    }
    const [rowSteady, rowRecounted] = await Promise.all([steady, recounted].map(async (l) => (await dayRows(pool, l, split)).find((r) => r.day === s2)));
    check('T3', splitSame && seconds.every((d) => d === s2) && rowSteady?.counted_ms === 0 && rowRecounted?.counted_ms === 60 * S,
        `day by day: the second close carries the unit's time from day 1's newest live row and reads the evidence before 00:00 (day 2: ${rowSteady?.counted_ms / S}+${rowSteady?.over_cap_ms / S} s after day 1 reached the set time; ${rowRecounted?.counted_ms / S}+${rowRecounted?.over_cap_ms / S} s after a recount of day 1 to 60 s), as the pure function`);
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t4(pool, { catalogId, ruleSetId }) {
    const [d1, d2] = [await dayFromToday(pool, -3), await dayFromToday(pool, -2)];
    const user = uid('t4u');
    const cohort = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1, learners: [user] });
    await storeChain(pool, { user, cohort, unit: 'unit-b', from: jstDayRange(d1).start + 3_600_000, n: 10 });
    const holder = await pool.connect();
    try {
        await holder.query('BEGIN');
        await holder.query(TRAINING_SQL.learnerLock, [user]);
        const both = Promise.all([close(pool, user, cohort), close(pool, user.toUpperCase(), cohort)]);
        await sleep(LEAD_MS);
        await holder.query('COMMIT');
        const statuses = (await both).map((r) => /** @type {any} */ (r).status ?? /** @type {any} */ (r).error_type).sort();
        const rows = await dayRows(pool, user, cohort);
        check('T4', statuses.join() === 'closed,nothing' && rows.length === 2, `two closes at once, both waiting on the learner lock: ${statuses.join(', ')}; ${rows.length} day rows`);
    } finally {
        holder.release();
    }
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t5t6(pool, { catalogId, ruleSetId }) {
    const [d1, d2] = [await dayFromToday(pool, -3), await dayFromToday(pool, -2)];
    const [first, closer, ctrl] = [uid('t5d'), uid('t5c'), uid('t5x')];
    const cohort = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1, learners: [first, closer, ctrl] });
    for (const user of [first, closer, ctrl]) await storeChain(pool, { user, cohort, unit: 'unit-b', from: jstDayRange(d1).start + 3_600_000, n: 10 });

    // Deletion first (its statements held HOLD_MS): the close waits for the account lock, then finds no stub.
    const c1 = await pool.connect();
    try {
        await deletionUpToStub(c1, first);
        const hold = c1.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]);
        await sleep(LEAD_MS);
        const t0 = Date.now();
        const closing = close(pool, first, cohort).then((r) => ({ r: /** @type {any} */ (r), ms: Date.now() - t0 }));
        await hold;
        await c1.query('COMMIT');
        const { r, ms } = await closing;
        const rows = await dayRows(pool, first, cohort);
        check('T5', ms >= BLOCKED_MS && r.reason === 'no_account' && rows.length === 0, `deletion first: the close waited ${ms} ms and answered ${r.status} (${r.reason ?? r.error_type}); day rows ${rows.length}`);
    } finally {
        c1.release();
    }

    // Close first: its statements (the core's locks and insert) held HOLD_MS; the deletion service
    // waits, then marks the new day rows and the streams with the tombstone's time.
    const c2 = await pool.connect();
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-verify-training-'));
    try {
        await c2.query('BEGIN');
        await c2.query(TRAINING_SQL.lock, [closer]);
        await c2.query(TRAINING_SQL.learnerLock, [closer]);
        // Day 1 with unit-a's whole set time (2 min) used, so T6 can show a marked day is not carried.
        const insertedRows = (await c2.query(TRAINING_TIME_SQL.insertDays, [closer, cohort, 'verify', [d1, d2], ['study-time/v1', 'study-time/v1'], [ruleSetId, ruleSetId], [catalogId, catalogId], [120000, 0], [13000, 0], [20, 0], ['f'.repeat(64), 'f'.repeat(64)]])).rows;
        const inserted = insertedRows.length;
        await c2.query(TRAINING_TIME_SQL.insertUnitDays, [[insertedRows.find((r) => r.day === d1)?.id], ['unit-a'], [120000], [13000]]);
        const holding = c2.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]).then(() => c2.query('COMMIT'));
        await sleep(LEAD_MS);
        const t0 = Date.now();
        const deleted = await deleteAccountData({
            pool, userId: closer, requestedBy: 'staff', authTime: null, billing: { config: null, stripe: null },
            logger: { log: () => {}, warn: () => {} }, uploadRoot, memory: { enabled: () => false, purge: async () => ({ ok: true }) }, invalidateCaches: () => {},
        });
        const waited = Date.now() - t0;
        await holding;
        const marked = await count(pool, `SELECT (SELECT count(*) FROM training_time_days t JOIN account_deletions d USING (user_id) WHERE t.user_id = $1 AND t.account_deleted_at = d.deleted_at)
            + (SELECT count(*) FROM training_time_streams s JOIN account_deletions d USING (user_id) WHERE s.user_id = $1 AND s.account_deleted_at = d.deleted_at) AS n`, [closer]);
        const live = await count(pool, 'SELECT (SELECT count(*) FROM training_time_days WHERE user_id = $1 AND account_deleted_at IS NULL) + (SELECT count(*) FROM training_time_streams WHERE user_id = $1 AND account_deleted_at IS NULL) AS n', [closer]);
        check('T5', inserted === 2 && deleted?.status === 'deleted' && waited >= BLOCKED_MS && marked === 3 && live === 0,
            `close first: the deletion service (${deleted?.status}) waited ${waited} ms, then marked the 2 new day rows and the stream with the tombstone time (${marked}); live ${live}`);
    } finally {
        c2.release();
        await fs.rm(uploadRoot, { recursive: true, force: true }).catch(() => {});
    }

    // Control: the day insert without the account lock, while a deletion is between its marks and COMMIT.
    const c3 = await pool.connect();
    try {
        await deletionUpToStub(c3, ctrl);
        const inserted = (await pool.query(TRAINING_TIME_SQL.insertDays, [ctrl, cohort, 'verify', [d1], ['study-time/v1'], [ruleSetId], [catalogId], [0], [0], [0], ['f'.repeat(64)]])).rowCount;
        await c3.query('COMMIT');
        const left = await count(pool, 'SELECT count(*) AS n FROM training_time_days WHERE user_id = $1 AND account_deleted_at IS NULL', [ctrl]);
        check('T5', inserted === 1 && left === 1, `control, the insert without the account lock: inserted ${inserted}, a live day row for a deleted account ${left}`);
    } finally {
        c3.release();
    }

    // T6: the deleted closer re-opened by a new sign-in, added again through the real add (as if on
    // the cohort's first day), studies unit-a again on day 2: its marked evidence is not counted, and
    // the marked day 1 (unit-a's whole set time) is not carried, so day 2 has the set time again.
    await reopenAccount(pool, closer, Date.now() / 1000 + 60);
    const readded = /** @type {any} */ (await addMember({ cohortSlug: String((await pool.query('SELECT slug FROM training_cohorts WHERE id = $1', [cohort])).rows[0].slug), userId: closer, role: 'learner', pool }));
    await pool.query("UPDATE training_memberships SET added_at = $3::timestamptz WHERE user_id = $1 AND cohort_id = $2 AND account_deleted_at IS NULL", [closer, cohort, iso(jstDayRange(d1).start + 3_600_000)]);
    await storeChain(pool, { user: closer, cohort, unit: 'unit-a', from: jstDayRange(d2).start + 10 * 3_600_000, n: 20 });
    const closed = /** @type {any} */ (await close(pool, closer, cohort));
    const rows = await dayRows(pool, closer, cohort);
    const liveRows = rows.filter((r) => r.account_deleted_at === null);
    check('T6', readded.status === 'added' && closed.status === 'closed' && rows.length === 4 && liveRows.length === 2
        && liveRows[0].counted_ms === 0 && liveRows[0].signals === 0 && liveRows[1].counted_ms === 120 * S && liveRows[1].over_cap_ms === 13 * S,
        `a re-opened account: added again (${readded.status}), its days closed again beside the marked ones (${liveRows.length} live, ${rows.length - liveRows.length} marked); day 1 ${liveRows[0]?.counted_ms} ms (the marked evidence not counted), day 2 ${liveRows[1]?.counted_ms / S}+${liveRows[1]?.over_cap_ms / S} s (the marked day 1 not carried)`);
}

/** @param {pg.Pool} pool */
async function t7(pool) {
    const [start, end, next] = [await dayFromToday(pool, 10), await dayFromToday(pool, 40), await dayFromToday(pool, 40)];
    const slugs = [`t7a-${uid('a').slice(4, 8)}`, `t7b-${uid('b').slice(4, 8)}`];
    await pool.query('INSERT INTO training_cohorts (slug, name, starts_on, ends_on) VALUES ($1, $3, $4::date, $5::date), ($2, $3, $6::date, $7::date)', [slugs[0], slugs[1], 'T7', start, end, next, await dayFromToday(pool, 70)]);
    const learner = uid('t7l');
    await pool.query('INSERT INTO auth.users (id) VALUES ($1::uuid)', [learner]);
    const holder = await pool.connect();
    try {
        await holder.query('BEGIN');
        await holder.query(TRAINING_SQL.learnerLock, [learner]);
        const both = Promise.all(slugs.map((cohortSlug) => addMember({ cohortSlug, userId: learner, role: 'learner', pool })));
        await sleep(LEAD_MS);
        await holder.query('COMMIT');
        const statuses = (await both).map((r) => /** @type {any} */ (r).status ?? /** @type {any} */ (r).error_type).sort();
        const live = await count(pool, "SELECT count(*) AS n FROM training_memberships WHERE user_id = $1 AND role = 'learner' AND account_deleted_at IS NULL", [learner]);
        check('T7', statuses.join() === 'added,overlapping' && live === 1, `two adds into cohorts that share a day, at once: ${statuses.join(', ')}; live learner rows ${live}`);
    } finally {
        holder.release();
    }
    // Control: the overlap check and the insert without the learner lock, interleaved.
    const other = uid('t7x');
    await pool.query('INSERT INTO auth.users (id) VALUES ($1::uuid)', [other]);
    const ids = (await pool.query('SELECT id FROM training_cohorts WHERE slug = ANY($1) ORDER BY slug', [slugs])).rows.map((r) => r.id);
    const [a, b] = [await pool.connect(), await pool.connect()];
    try {
        for (const c of [a, b]) {
            await c.query('BEGIN');
            await c.query(TRAINING_SQL.lock, [other]);
        }
        const seen = [(await a.query(TRAINING_SQL.overlapping, [other, ids[0]])).rowCount, (await b.query(TRAINING_SQL.overlapping, [other, ids[1]])).rowCount];
        await a.query(TRAINING_SQL.addMember, [other, ids[0], 'learner']);
        await a.query('COMMIT');
        await b.query(TRAINING_SQL.addMember, [other, ids[1], 'learner']);
        await b.query('COMMIT');
        const live = await count(pool, "SELECT count(*) AS n FROM training_memberships WHERE user_id = $1 AND role = 'learner' AND account_deleted_at IS NULL", [other]);
        check('T7', seen.join() === '0,0' && live === 2, `control, without the learner lock: both checks saw no overlap and ${live} learner rows remain`);
    } finally {
        a.release();
        b.release();
    }
}

/** @param {pg.Pool} pool */
async function t8(pool) {
    const instants = ['2026-11-04T14:59:59.999Z', '2026-11-04T15:00:00.000Z', '2026-12-31T14:59:59.999Z', '2026-12-31T15:00:00.000Z', '2027-02-28T15:00:00.000Z', '2028-02-28T15:00:00.000Z', '2028-02-29T15:00:00.123Z'];
    const { rows } = await pool.query(`SELECT to_char((t AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS day, floor(extract(epoch FROM t) * 1000)::bigint AS ms
        FROM unnest($1::timestamptz[]) WITH ORDINALITY AS x(t, i) ORDER BY i`, [instants]);
    const bad = rows.filter((r, i) => r.day !== jstDayOf(Date.parse(instants[i])) || Number(r.ms) !== Date.parse(instants[i]));
    let roundTrip = true;
    for (let day = '2028-02-27'; day <= '2028-03-01'; day = nextDay(day)) roundTrip &&= jstDayOf(jstDayRange(day).start) === day;
    check('T8', bad.length === 0 && roundTrip, `Japan-time days and whole milliseconds agree in SQL and JavaScript at ${instants.length} instants around 15:00Z (leap day too)${bad.length ? `; differ: ${bad.map((r) => r.day).join(', ')}` : ''}`);
}

export async function main(argv = process.argv.slice(2)) {
    const { url, help } = parseArgs(argv);
    if (help || !url) {
        console.log('Usage: node scripts/db/verify-training.mjs --url postgres://<user>@<host>:<port>/<empty throwaway database>');
        console.log('Exit: 0 all passed, 1 a check failed, 2 refused or usage.');
        return help ? 0 : 2;
    }
    const pool = new pg.Pool({ connectionString: url, max: 8 });
    try {
        const { rows: [target] } = await pool.query(`SELECT current_database() AS db,
            (SELECT count(*) FROM pg_tables WHERE schemaname IN ('public', 'auth'))::int AS tables,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
            current_setting('server_version') AS version`, [ROLE]);
        if (target.tables > 0 || target.role || !target.superuser) {
            console.error(`Refused: ${target.db} must be an empty throwaway database (tables in public/auth: ${target.tables}), `
                + `the cluster must not have the role ${ROLE} (${target.role}), and the user must be a superuser (${target.superuser}).`);
            return 2;
        }
        console.log(`# verify-training: database ${target.db}, PostgreSQL ${target.version}`);
        await waitPastJstMidnight({ query: (sql) => pool.query(sql), budgetS: 60 });
        const files = (await fs.readdir(MIGRATIONS)).filter((name) => /^\d+_.+\.sql$/i.test(name)).sort((a, b) => a.localeCompare(b));
        for (const run of [1, 2]) {
            for (const file of files) await applyMigration(pool, file);
            check('M', files.includes(FILE), `run ${run}: applied ${files.length} migrations (${files[0]} … ${files.at(-1)}), each in its own transaction`);
        }
        const ids = await t2(pool);
        await t1(pool, ids);
        await t3(pool, ids);
        await t4(pool, ids);
        await t5t6(pool, ids);
        await t7(pool);
        await t8(pool);
    } catch (error) {
        check('ERR', false, /** @type {Error} */ (error).stack ?? String(error));
    } finally {
        await pool.end();
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`# ${results.length - failed.length} passed, ${failed.length} failed`);
    return exitCode({ failed: failed.length, skipped: 0, allowSkip: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
}
