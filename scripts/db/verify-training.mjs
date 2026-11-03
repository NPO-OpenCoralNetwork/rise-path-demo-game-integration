#!/usr/bin/env node
// @ts-check
/**
 * Proves migrations 022 and 023 (job training: study time records and their recounts) and the code
 * that uses them (tools/core/trainingTime.js: configuration, closing, the signal write and the live
 * values; tools/core/trainingTimeCheck.js: the check of closed days; tools/core/trainingTimeRecount.js:
 * the staff recount, its dry run and its write; the membership add of tools/core/training.js; the
 * deletion's two marks) on a real, THROWAWAY PostgreSQL (16, as the VM's pgvector/pgvector:0.8.7-pg16).
 * npm test pins the SQL text (server/tests/migration022.test.js, migration023.test.js,
 * trainingTimeCore.test.js, trainingTimeCheck.test.js, trainingTimeRecount.test.js) and runs the code
 * on an in-memory fake; CI runs this script on the VM's image (job "Database checks",
 * scripts/ci/db-checks.sh). It is the 確かめ方 of server/migrations/README.md for 022 and 023.
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
 *       cohort and day (the core's insertDays) with a recount beside it (its row names its recount,
 *       023), the newest live row the current value; the flag, sequence and per-day CHECKs
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
 *   T9  a signal (the real write) against an account deletion, both orders: deletion first, the
 *       signal waits for the account lock and writes nothing (account_deleted, 401); signal first,
 *       the deletion service waits, then marks the new stream with the tombstone's time; control:
 *       the write without the account lock leaves a live stream for a deleted account
 *   T10 a close against a signal in progress, for each learner lock. closeDays': the write's
 *       statements sent by this script on its own connection, not recordSignal (a chain's late signal
 *       on a final day, uncommitted): the close waits and counts it; control: without the learner's
 *       lock there, the close (awaited before their COMMIT) misses it. recordSignal's: the real write
 *       held after its insert; a close started LEAD_MS later waits for its COMMIT, then closes the
 *       final days as the pure function counts every stored signal (the new one in a closed day's
 *       evidence only when the instants put it there); control: the write without its learner lock,
 *       held until a close ends: the close does not wait
 *   T11 a signal against a setting in progress: it waits for the settings lock and is stored with
 *       the setting; control: without the lock it is refused (time_not_configured) although the
 *       setting's clock reading came before its own
 *   T12 a chain across 00:00 JST through the write's statements: one stream per day with the chain's
 *       start on both; the write's state (signalState) finds the chain's last signal (seq 3) over
 *       both days' streams, with its time and the chain's start; closing both days equals the pure
 *       function
 *   T13 the real write on the database clock: a first signal, a beat (its pair counted in the
 *       answer), too soon, a stop, after the stop; one stream and the flags; the GET's live values
 *   T14 a clock behind a closed day stores nothing; the GET (readStudyTime) closes and reads under
 *       its locks: a close started on another connection between the GET's clock reading and its
 *       close, or during its read (after its close), waits for the GET's COMMIT and finds nothing
 *       final, the GET's total is the pure function's; control: without the GET's learner lock the
 *       first close commits in between and the GET fails. (That the close and the read are one
 *       transaction is the statement order npm test pins.)
 *   T15 signalState's other columns: the clock guard's window end (the last closed day with the
 *       widest gapMs among its live rows, a recount's included: the close's alone, then wider with a
 *       recount row, not narrowed by a later one; a marked row, and a recount of a later or an earlier
 *       day, are not read),
 *       yesterday's gapMs, today's unit list, the places (each chain's last signal, yesterday's and
 *       today's streams)
 *   T16 a signal's state read that fails (a statement on a missing table) rolls back to its
 *       savepoint: the signal is stored, the answer names the error; control: without the savepoint
 *       the COMMIT of the aborted transaction stores nothing, and the write answers an error
 *   T17 023: a recount row names a recount, a close row none (the CHECK both ways); only a recount of
 *       its own cohort (the composite foreign key); a recount's record names an override, its days in
 *       order and the plan's sha256 in lower-case hex, and refuses UPDATE and DELETE (23001). The check
 *       (verifyCohort) on PostgreSQL: days closed by the core check (a day with three units, which the
 *       database's collation may order otherwise than the code: en_US.utf8 ignores '-'; the check
 *       again with the unit rows in reverse order, on any cluster; a chain out of the last day across
 *       00:00 JST, a lone signal before the first day); recount rows as a recount writes them (the
 *       override's values and evidence window, one more signal on each day, the second day with the
 *       first's new unit time carried) check; a changed value and a version this code does not have
 *       are found. The deletion's marks reach the recount rows with the foreign key and the CHECK in
 *       place; the record stays
 *   T18 the check's snapshot is REPEATABLE READ and read only (a write in it: 25006). It reads each
 *       learner in one snapshot: an account deletion committing between its read of the rows and of
 *       the evidence changes nothing it reports; control: with a plain BEGIN (READ COMMITTED) the same
 *       deletion makes every day with evidence differ. A table rewrite (ALTER COLUMN … USING, not
 *       MVCC-safe) held HOLD_MS, then committed, while the check runs: its LOCK … NOWAIT (ACCESS
 *       SHARE, before its snapshot) fails and is tried again, no backend waiting on a lock meanwhile,
 *       then it reads both days; control: without that LOCK and its 20 ms limit, the try's read of no
 *       rows takes its snapshot, then waits for the rewritten table, and reads no day of it (the gap,
 *       up to 20 ms a try, that the LOCK closes). The same for the cohort's snapshot with the
 *       memberships rewritten (control: it reads no learner). A migration altering two of the tables a
 *       snapshot locks, in the other order (memberships then cohorts; the recounts' table then the
 *       days'), or rebuilding an index of the days' table and then altering the recounts' (of the
 *       memberships, then the cohorts), HOLD_MS apart: its second statement goes through and the
 *       check reads both days; controls: with a LOCK that waits, or a try whose read waits for the
 *       index (the learner's; the cohort's), PostgreSQL cancels the migration as a deadlock (40P01).
 *       The tables each snapshot's reads lock (pg_locks) are those its LOCK locks; a try's opening
 *       statements lock every index of them, the LOCK and the 20 ms limit alone none
 *   T19 a staff recount (D12) through the core, of days already final (other rules for the first of
 *       three days; the later ones change through the carry). The dry run's reads (its first
 *       snapshot's, a learner's, a learner's history), each without its LOCK, lock exactly the tables
 *       their LOCK locks, and their opening statements every index of them. The write without its
 *       LOCKs and its read of no rows (its COMMIT sent as ROLLBACK), read by its pid after its last
 *       statement, holds exactly the tables its LOCKs lock, none in a stronger mode; its read of no
 *       rows after the LOCKs locks every index of them (control: the LOCKs and the 20 ms limit alone,
 *       none). Through the core: the write's sha256 is the dry run's; it appends rows in day order
 *       after the old ones, which stay as they were; each learner's current rows are the pure
 *       function's with each day's own versions (the override's on the recounted day) and the new
 *       carry, and the check finds nothing; the record holds no learner value (cohortRecounts and
 *       learnerHistory read it back); a dry run again changes nothing, a write with its sha256 is
 *       unchanged, the first sha256 again plan_changed; the fingerprint's day ids and count are the
 *       evidence read's (+1 after a signal stored in its window, in a stream already there). A close
 *       of a day added to the cohort (UPDATE ends_on, as T3), held after its insert: the write
 *       started LEAD_MS later tries until it ends, then answers plan_changed and writes nothing, and
 *       the check finds nothing; the same when the close commits while the write's try is held after
 *       its account lock, before its learner lock; control: the write without its learner lock does
 *       not wait and recounts, and the check then finds that day's values. The write held after its
 *       last insert: the deletion service waits, then marks the recount rows with the tombstone's
 *       time, and the record stays; control: without the account lock, while a deletion is between
 *       its marks and COMMIT, the recount rows of the deleted account stay live. Two writes with one
 *       sha256 at once: one recounted, one plan_changed, one record. A migration altering the
 *       signals' table once the write's first try took its first learner's locks, then the days'
 *       table HOLD_MS later: no backend waits on a lock meanwhile, its second statement goes through
 *       and the write recounts after it (its tries); control: without the 20 ms limit, the LOCKs and
 *       the read of no rows, the write waits, and PostgreSQL cancels the migration as a deadlock (40P01)
 * The checks compare Japan-time days read at different moments: like db-checks.sh before all the
 * verify scripts, the script first waits past 00:00 JST when less than 90 s are left (its run takes
 * less), and every recounted day is two days ago or earlier, final at once.
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
import {
    TRAINING_TIME_SQL, closeDays, evidenceDigest, learnerDays, loadCatalog, loadRules, readStudyTime, recordSignal, setCohortTime, signalOf,
} from '../../tools/core/trainingTime.js';
import { CHECK_SQL, LOCK_RETRY, SNAPSHOT_LOCKS, readCohort, readLearner, rulesVersionOf, verifyCohort } from '../../tools/core/trainingTimeCheck.js';
import {
    RECOUNT_LOCKS, RECOUNT_SQL, cohortRecounts, learnerHistory, planRecount, readRecountHead, readRecountLearner, recountCohort,
} from '../../tools/core/trainingTimeRecount.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(ROOT, 'server', 'migrations');
const FILE = '022_training_study_time.sql';
const FILE_023 = '023_training_study_time_recounts.sql';
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
// Other rules: smaller pieces, and the evidence read from further back and ahead (gapMs, idleMs).
const RULES_IN_2 = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 29 * S, creditCapMs: 5 * S, idleMs: 151 * S } });
const RULES_2 = /** @type {any} */ (parseTimeRules(RULES_IN_2)).rules;
// The rules from the third day of T19's cohorts: other pieces again.
const RULES_IN_3 = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 6 * S } });
const RULES_3 = /** @type {any} */ (parseTimeRules(RULES_IN_3)).rules;
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
 * One page's chain at chosen instants (past days too), stored with the signal write's own statements
 * (TRAINING_TIME_SQL.insertStream and insertSignal, the stub needed) but without its locks and
 * admission: a stream row for each Japan-time day of its signals (made by the first signal of that
 * day), then a narrow row per signal; `n` signals `every` ms apart, each with input and focus.
 * Returns them as the counting reads them.
 * @param {pg.Pool} pool @param {{ user: string, cohort: string, unit: string, from: number, n: number, every?: number }} c
 */
async function storeChain(pool, { user, cohort, unit, from, n, every = 7 * S }) {
    const chain = uid('chn');
    /** @type {import('../../shared/training/studyTime.js').Signal[]} */
    const out = [];
    for (let seq = 0; seq < n; seq += 1) {
        const at = from + seq * every;
        await pool.query(TRAINING_TIME_SQL.insertStream, [user, cohort, unit, chain, iso(from), iso(at)]);
        const stored = (await pool.query(TRAINING_TIME_SQL.insertSignal, [user, chain, iso(at), seq, 6])).rowCount;
        if (stored !== 1) throw new Error(`storeChain: signal ${seq} of ${chain} not stored`);
        out.push({ chain, seq, unit, born: from, at, stop: false, focus: true, input: true });
    }
    return out;
}

/** The core's close (staff). @param {pg.Pool} pool @param {string} user @param {string} cohort */
const close = (pool, user, cohort) => closeDays({ userId: user, cohortId: cohort, computedBy: 'verify', pool });
/** @param {pg.Pool} pool @param {string} user @param {string} cohort */
const dayRows = async (pool, user, cohort) => (await pool.query(`SELECT id, to_char(day, 'YYYY-MM-DD') AS day, kind, counted_ms, over_cap_ms, signals, evidence_sha256, rule_set_id, catalog_version_id, account_deleted_at
    FROM training_time_days WHERE user_id = $1 AND cohort_id = $2 ORDER BY day, id`, [user, cohort])).rows;

/**
 * A recount's record (023), as a staff recount writes it: its id. Its rows name it.
 * @param {pg.Pool} pool @param {string} cohort @param {string} from @param {string} to @param {string} ruleSetId
 */
const recountRecord = async (pool, cohort, from, to, ruleSetId) => String((await pool.query(`INSERT INTO training_time_recomputes (cohort_id, from_day, to_day, rule_set_id, plan_sha256, recomputed_by, reason)
    VALUES ($1, $2::date, $3::date, $4, repeat('a', 64), 'verify', 'verify') RETURNING id`, [cohort, from, to, ruleSetId])).rows[0].id);

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

/**
 * A change to one connection's statements, each named exactly: `skip`, not sent (a control without a
 * lock); `send`, sent as another text (COMMIT as ROLLBACK, a begin as a plain BEGIN); `holdAfter`,
 * once it returned and before going on, sleep holdMs in the database or, with `until`, wait for the
 * promise it returns (called then: the script sees the hold begin); `after`, then `run` (another
 * connection's transaction between two statements of this one; it gets this connection's backend pid).
 * @typedef {{ skip?: string[], send?: Map<string, string>, holdAfter?: string, holdMs?: number, until?: () => Promise<unknown>,
 *   after?: string, run?: (pid: number) => Promise<unknown> }} ConnectionChange
 */

/**
 * A pool for the core whose n-th connection (in the order the core asks for them) sends its
 * statements with changes[n - 1]; later ones are plain.
 * @param {pg.Pool} pool @param {ConnectionChange[]} changes
 * @returns {any} the core's pool
 */
function changedConnections(pool, changes) {
    let asked = 0;
    return {
        query: (/** @type {string} */ sql, /** @type {unknown[]} */ params) => pool.query(sql, params),
        connect: async () => {
            const change = changes[asked];
            asked += 1;
            const client = await pool.connect();
            if (!change) return client;
            const { skip = [], send = new Map(), holdAfter = '', holdMs = 0, until = null, after = '', run = null } = change;
            return {
                query: async (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
                    if (skip.includes(sql)) return { rows: [], rowCount: 0 };
                    const result = await client.query(send.get(sql) ?? sql, params);
                    if (sql === holdAfter && until) await until();
                    else if (sql === holdAfter && holdMs) await client.query('SELECT pg_sleep($1)', [holdMs / 1000]);
                    if (sql === after && run) await run(client.processID);
                    return result;
                },
                release: (/** @type {any} */ error) => client.release(error),
            };
        },
    };
}

/**
 * A pool for the core whose FIRST connection (a signal's transaction) sends its statements with a
 * change; later ones (a close, the live values' read) are plain.
 * @param {pg.Pool} pool @param {ConnectionChange} change
 */
const firstConnection = (pool, change) => changedConnections(pool, [change]);

/** A promise the script settles: shut resolves once open() is called. */
function gate() {
    let open = () => {};
    /** @type {Promise<void>} */
    const shut = new Promise((resolve) => {
        open = () => resolve();
    });
    return { shut, open: () => open() };
}

/**
 * The changes for a recount through the core in a cohort of `learners` live learners: none on its
 * dry run's connections (the cohort's snapshot, then each learner's, in the order it asks for them),
 * `change` on each try of its write after them.
 * @param {number} learners @param {ConnectionChange} change @returns {ConnectionChange[]}
 */
const writeOnly = (learners, change) => [...Array.from({ length: 1 + learners }, () => ({})), ...Array.from({ length: LOCK_RETRY.tries }, () => change)];

/**
 * A cohort in session from today (to today + 30) with learners added now (the membership's default
 * time, so a deletion's mark is never earlier) and, unless `setting` is false, a setting from today.
 * No day is final yet, so a signal's answer closes nothing.
 * @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string, learners: string[], setting?: boolean }} c
 */
async function learnerToday(pool, { catalogId, ruleSetId, learners, setting = true }) {
    const today = await dayFromToday(pool, 0);
    const id = uid('coh');
    await pool.query('INSERT INTO training_cohorts (id, slug, name, starts_on, ends_on) VALUES ($1, $2, $3, $4::date, $5::date)', [id, `v-${id.slice(4, 8)}-${counter}`, 'verify', today, await dayFromToday(pool, 30)]);
    if (setting) {
        await pool.query("INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_at, set_by, reason) VALUES ($1, $2, $3, $4::date, $5::timestamptz, 'verify', 'verify')",
            [id, catalogId, ruleSetId, today, iso(jstDayRange(today).start - 86_400_000)]);
    }
    for (const learner of learners) {
        await pool.query('INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT (id) DO NOTHING', [learner]);
        await pool.query("INSERT INTO training_memberships (cohort_id, user_id, role) VALUES ($1, $2, 'learner')", [id, learner]);
    }
    return { cohort: id, today };
}

/**
 * A signal through the real write (recordSignal): a new chain's first signal on unit-a unless `s`
 * says otherwise.
 * @param {any} pool @param {string} user @param {string} cohort @param {Record<string, unknown>} [s]
 * @returns {Promise<any>}
 */
const sendSignal = (pool, user, cohort, s = {}) => recordSignal({ userId: user, cohortId: cohort, pool,
    signal: { unitKey: 'unit-a', chainId: uid('chn'), seq: 0, stop: false, focus: true, input: true, ...s } });
/** @param {pg.Pool} pool @param {string} user @param {boolean} liveOnly */
const streamsOf = (pool, user, liveOnly) => count(pool, `SELECT count(*) AS n FROM training_time_streams WHERE user_id = $1${liveOnly ? ' AND account_deleted_at IS NULL' : ''}`, [user]);
/** Every live stored signal of a learner in a cohort, as the counting reads them. @param {pg.Pool} pool @param {string} user @param {string} cohort */
const storedSignals = async (pool, user, cohort) => (await pool.query(`SELECT s.chain_id, s.unit_key, floor(extract(epoch FROM s.chain_started_at) * 1000)::bigint AS born, g.seq,
    floor(extract(epoch FROM g.received_at) * 1000)::bigint AS at, g.flags
    FROM training_time_streams s JOIN training_time_signals g ON g.stream_id = s.id
    WHERE s.user_id = $1 AND s.cohort_id = $2 AND s.account_deleted_at IS NULL ORDER BY s.chain_id, g.seq`, [user, cohort])).rows.map(signalOf);

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
    const recount = await recountRecord(pool, cohort, '2026-10-01', '2026-10-02', ruleSetId);
    await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
        VALUES ($1, $2, '2026-10-01', 'recompute', 'study-time/v1', $3, $4, 3000, 0, 0, repeat('c', 64), 'verify', $5)`, [user, cohort, ruleSetId, catalogId, recount]);
    const current = (await pool.query(TRAINING_TIME_SQL.currentDays, [user, cohort])).rows.map((r) => `${r.day}:${r.kind}:${r.counted_ms}`);
    check('T1', closes.join() === '1,0' && current.join() === '2026-10-01:recompute:3000', `one close per learner, cohort and day (the core's insert: ${closes.join(', ')}); a recount beside it is the current value: ${current.join()}`);

    const dayCheck = (counted, over) => codeOf(pool, `INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
        VALUES ($1, $2, '2026-10-02', 'recompute', 'study-time/v1', $3, $4, $5, $6, 0, repeat('d', 64), 'verify', $7)`, [user, cohort, ruleSetId, catalogId, counted, over, recount]);
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
    await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
        VALUES ($1, $2, $3::date, 'recompute', 'study-time/v1', $4, $5, 1000, 0, 0, repeat('e', 64), 'verify', $6)`, [user, cohort, d2, ruleSetId, catalogId, await recountRecord(pool, cohort, d2, d2, ruleSetId)]);
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
    const recount = (await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
        VALUES ($1, $2, $3::date, 'recompute', 'study-time/v1', $4, $5, 60000, 0, 0, repeat('a', 64), 'verify', $6) RETURNING id`, [recounted, split, s1, ruleSetId, catalogId, await recountRecord(pool, split, s1, s1, ruleSetId)])).rows[0].id;
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

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t9(pool, { catalogId, ruleSetId }) {
    const [first, writer, ctrl] = [uid('t9d'), uid('t9w'), uid('t9x')];
    const { cohort } = await learnerToday(pool, { catalogId, ruleSetId, learners: [first, writer, ctrl] });

    // Deletion first (held HOLD_MS): the signal waits for the account lock, then finds no stub.
    const c1 = await pool.connect();
    try {
        await deletionUpToStub(c1, first);
        const hold = c1.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]);
        await sleep(LEAD_MS);
        const t0 = Date.now();
        const sending = sendSignal(pool, first, cohort).then((r) => ({ r, ms: Date.now() - t0 }));
        await hold;
        await c1.query('COMMIT');
        const { r, ms } = await sending;
        const streams = await streamsOf(pool, first, false);
        check('T9', ms >= BLOCKED_MS && r.status === 'deleted_account' && streams === 0,
            `deletion first: the signal waited ${ms} ms and answered ${r.status ?? r.error_type}${r.status === 'deleted_account' ? ' (401 at the route)' : ''}; streams ${streams}`);
    } finally {
        c1.release();
    }

    // Signal first: the real write held HOLD_MS after its insert; the deletion service waits, then
    // marks the new stream with the tombstone's time.
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-verify-training-'));
    try {
        const writing = sendSignal(firstConnection(pool, { holdAfter: TRAINING_TIME_SQL.insertSignal, holdMs: HOLD_MS }), writer, cohort);
        await sleep(LEAD_MS);
        const t0 = Date.now();
        const deleted = await deleteAccountData({
            pool, userId: writer, requestedBy: 'staff', authTime: null, billing: { config: null, stripe: null },
            logger: { log: () => {}, warn: () => {} }, uploadRoot, memory: { enabled: () => false, purge: async () => ({ ok: true }) }, invalidateCaches: () => {},
        });
        const waited = Date.now() - t0;
        const written = await writing;
        const marked = await count(pool, 'SELECT count(*) AS n FROM training_time_streams s JOIN account_deletions d USING (user_id) WHERE s.user_id = $1 AND s.account_deleted_at = d.deleted_at', [writer]);
        const live = await streamsOf(pool, writer, true);
        check('T9', written.status === 'accepted' && deleted?.status === 'deleted' && waited >= BLOCKED_MS && marked === 1 && live === 0,
            `signal first: the write ${written.status ?? written.error_type}; the deletion service (${deleted?.status}) waited ${waited} ms; streams marked with the tombstone time ${marked}, live ${live}`);
    } finally {
        await fs.rm(uploadRoot, { recursive: true, force: true }).catch(() => {});
    }

    // Control: the write without the account's shared lock, while a deletion is between its marks and COMMIT.
    const c3 = await pool.connect();
    try {
        await deletionUpToStub(c3, ctrl);
        const written = await sendSignal(firstConnection(pool, { skip: [TRAINING_SQL.lock] }), ctrl, cohort);
        await c3.query('COMMIT');
        const live = await streamsOf(pool, ctrl, true);
        check('T9', written.status === 'accepted' && live === 1, `control, the write without the account lock: ${written.status}, a live stream for a deleted account ${live}`);
    } finally {
        c3.release();
    }
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t10(pool, { catalogId, ruleSetId }) {
    // closeDays' learner lock, against the write's statements sent by this script on its own
    // connection (not through recordSignal): day 2 is final (two days ago), and a late signal of a
    // chain, with a clock reading before the close's, is held uncommitted while the close runs. With
    // the learner's lock there, the close waits for it and counts it; control: without it, the close
    // (awaited before their COMMIT: none of their locks is in its way, so on any runner) misses it.
    const d1 = await dayFromToday(pool, -3);
    const d2 = nextDay(d1);
    const [locked, unlocked] = [uid('t10l'), uid('t10u')];
    const cohort = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1, learners: [locked, unlocked] });
    for (const [user, learnerLock] of /** @type {const} */ ([[locked, true], [unlocked, false]])) {
        const signals = await storeChain(pool, { user, cohort, unit: 'unit-b', from: jstDayRange(d2).start + 3_600_000, n: 10 });
        const last = /** @type {import('../../shared/training/studyTime.js').Signal} */ (signals.at(-1));
        const late = { ...last, seq: 10, at: last.at + 7 * S };
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            await c.query(TRAINING_SQL.lock, [user]);
            if (learnerLock) await c.query(TRAINING_SQL.learnerLock, [user]);
            await c.query(TRAINING_TIME_SQL.settingsLockShared, [cohort]);
            await c.query(TRAINING_TIME_SQL.insertStream, [user, cohort, late.unit, late.chain, iso(late.born), iso(late.at)]);
            const inserted = (await c.query(TRAINING_TIME_SQL.insertSignal, [user, late.chain, iso(late.at), late.seq, 6])).rowCount;
            const closing = close(pool, user, cohort);
            /** @type {any} */
            let closed;
            if (learnerLock) {
                await sleep(LEAD_MS);
                await c.query('COMMIT');
                closed = await closing;
            } else {
                closed = await closing;
                await c.query('COMMIT');
            }
            const row = (await dayRows(pool, user, cohort)).find((r) => r.day === d2);
            const w = evidenceWindow(jstDayRange(d2).start, jstDayRange(d2).end, RULES.counting);
            const all = [...signals, late].filter((s) => s.at >= w.from && s.at <= w.to);
            const lateOne = row?.evidence_sha256 === evidenceDigest(all) ? 'included' : row?.evidence_sha256 === evidenceDigest(all.filter((s) => s !== late)) ? 'missed' : 'neither';
            if (learnerLock) {
                check('T10', inserted === 1 && closed.status === 'closed' && row?.signals === 11 && lateOne === 'included',
                    `closeDays' learner lock, against the write's statements sent by this script (uncommitted for ${LEAD_MS} ms after the close began): the close ${closed.status ?? closed.error_type}, day 2 with ${row?.signals} signals, the late one ${lateOne}`);
            } else {
                check('T10', inserted === 1 && closed.status === 'closed' && row?.signals === 10 && lateOne === 'missed',
                    `control, those statements without the learner's lock (the close awaited before their COMMIT): the close ${closed.status ?? closed.error_type}, day 2 with ${row?.signals} of the ${all.length} signals in its window, the late one ${lateOne}`);
            }
        } finally {
            c.release();
        }
    }

    // recordSignal's learner lock, through the real write: learners of a cohort in session from d1,
    // each with a chain stored on d2, so a close finds final days. The write (a new chain's first
    // signal) is held HOLD_MS after its insert; a close started LEAD_MS later waits for its COMMIT,
    // then closes the final days as the pure function counts every stored signal (the new one is in a
    // closed day's evidence only when the instants put it there; recordSignal's own close, after its
    // COMMIT, queues behind this one). Control: the write without its learner lock, held after its
    // insert until a close started then has ended (a close that waited for the write would end only
    // at the lock timeout, account_busy).
    const ends = await dayFromToday(pool, 30);
    const [writer, ctrl] = [uid('t10w'), uid('t10x')];
    const open = await cohortWith(pool, { startsOn: d1, endsOn: ends, catalogId, ruleSetId, from: d1, learners: [writer, ctrl] });
    for (const user of [writer, ctrl]) await storeChain(pool, { user, cohort: open, unit: 'unit-b', from: jstDayRange(d2).start + 3_600_000, n: 10 });
    const chainId = uid('chn');
    const writing = sendSignal(firstConnection(pool, { holdAfter: TRAINING_TIME_SQL.insertSignal, holdMs: HOLD_MS }), writer, open, { chainId });
    await sleep(LEAD_MS);
    const t0 = Date.now();
    const closed = /** @type {any} */ (await close(pool, writer, open));
    const waited = Date.now() - t0;
    const written = await writing;
    const stored = await storedSignals(pool, writer, open);
    const mine = stored.find((s) => s.chain === chainId);
    const rows = closed.status === 'closed' ? (await dayRows(pool, writer, open)).filter((r) => r.day <= closed.toDay) : [];
    const want = closed.status === 'closed'
        ? countDays({ fromDay: d1, toDay: closed.toDay, signals: stored, rulesOf: () => RULES, setMsOf: () => setMsOf(unitsOf(2, 30)), carriedMs: new Map(), cohort: cohortRange(d1, ends) }).days
        : [];
    let asPure = rows.length > 0 && rows.length === want.length;
    let mineIn = false;
    for (const [i, row] of rows.entries()) {
        const w = evidenceWindow(jstDayRange(row.day).start, jstDayRange(row.day).end, RULES.counting);
        const evidence = stored.filter((s) => s.at >= w.from && s.at <= w.to);
        mineIn ||= mine !== undefined && evidence.includes(mine);
        asPure &&= row.day === want[i]?.day && row.counted_ms === want[i].countedMs && row.signals === evidence.length && row.evidence_sha256 === evidenceDigest(evidence);
    }
    check('T10', written.status === 'accepted' && mine !== undefined && closed.status === 'closed' && waited >= BLOCKED_MS && asPure,
        `recordSignal's learner lock, the real write held ${HOLD_MS} ms after its insert (then ${written.status ?? written.error_type}): a close started ${LEAD_MS} ms later waited ${waited} ms, then ${closed.status ?? closed.error_type} ${rows.length} days ${asPure ? 'as' : 'unlike'} the pure function on every stored signal (the new one in a closed day's evidence: ${mineIn ? 'yes' : 'no'})`);

    const held = gate();
    const ended = gate();
    const sending = sendSignal(firstConnection(pool, {
        skip: [TRAINING_SQL.learnerLock], holdAfter: TRAINING_TIME_SQL.insertSignal, until: () => { held.open(); return ended.shut; },
    }), ctrl, open);
    const reached = await Promise.race([held.shut.then(() => true), sending.then(() => false)]);
    const t1 = Date.now();
    /** @type {any} */
    let free;
    try {
        free = await close(pool, ctrl, open);
    } finally {
        ended.open();
    }
    const freeMs = Date.now() - t1;
    const sent = await sending;
    check('T10', reached && free.status === 'closed' && sent.status === 'accepted',
        `control, the real write without its learner lock: ${reached ? 'held after its insert' : 'never held'}, a close started then ${free.status ?? free.error_type} in ${freeMs} ms before the write's COMMIT (the write then ${sent.status ?? sent.error_type})`);
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t11(pool, { catalogId, ruleSetId }) {
    const [waiter, missed] = [uid('t11w'), uid('t11m')];
    const a = await learnerToday(pool, { catalogId, ruleSetId, learners: [waiter], setting: false });
    const b = await learnerToday(pool, { catalogId, ruleSetId, learners: [missed], setting: false });
    /** A cohort's first setting from today, inserted under its settings lock and not committed. @param {pg.PoolClient} c @param {string} cohort @param {string} today */
    const setting = async (c, cohort, today) => {
        await c.query('BEGIN');
        await c.query(TRAINING_TIME_SQL.settingsLock, [cohort]);
        return (await c.query(TRAINING_TIME_SQL.insertSetting, [cohort, catalogId, ruleSetId, today, 'verify', 'T11'])).rows[0]?.id ?? null;
    };

    // A setting in progress (held HOLD_MS): the signal waits on the settings lock, then sees it.
    const c1 = await pool.connect();
    try {
        const set = await setting(c1, a.cohort, a.today);
        const hold = c1.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]);
        await sleep(LEAD_MS);
        const t0 = Date.now();
        const sending = sendSignal(pool, waiter, a.cohort).then((r) => ({ r, ms: Date.now() - t0 }));
        await hold;
        await c1.query('COMMIT');
        const { r, ms } = await sending;
        const after = await count(pool, 'SELECT count(*) AS n FROM training_time_signals g JOIN training_time_streams s ON s.id = g.stream_id WHERE s.user_id = $1 AND g.received_at > (SELECT set_at FROM training_cohort_time_settings WHERE cohort_id = $2)', [waiter, a.cohort]);
        const outcome = r.status === 'accepted' ? 'was stored with it' : `answered ${r.status ?? r.error_type}${r.reason ? ` (${r.reason})` : ''}`;
        check('T11', set !== null && ms >= BLOCKED_MS && r.status === 'accepted' && after === 1,
            `a signal waited ${ms} ms for a setting in progress, then ${outcome} (signals received after its set_at: ${after})`);
    } finally {
        c1.release();
    }

    // Control: without the settings lock the signal misses a setting whose clock reading came before its own.
    const c2 = await pool.connect();
    try {
        const set = await setting(c2, b.cohort, b.today);
        // Read after the setting's clock and before the signal's (microseconds, as stored).
        const before = String((await pool.query('SELECT clock_timestamp()::text AS t')).rows[0].t);
        const r = await sendSignal(firstConnection(pool, { skip: [TRAINING_TIME_SQL.settingsLockShared] }), missed, b.cohort);
        await c2.query('COMMIT');
        const earlier = (await pool.query('SELECT set_at < $2::timestamptz AS earlier FROM training_cohort_time_settings WHERE cohort_id = $1', [b.cohort, before])).rows[0]?.earlier === true;
        const stored = await streamsOf(pool, missed, false);
        check('T11', set !== null && r.status === 'refused' && r.reason === 'time_not_configured' && earlier && stored === 0,
            `control, the signal without the settings lock: ${r.reason ?? r.status}, although the setting's clock reading (set_at) came before the signal's (${earlier})`);
    } finally {
        c2.release();
    }
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t12(pool, { catalogId, ruleSetId }) {
    // A chain across 00:00 JST through the write's statements: 23:59:46, :53, 00:00:00.000, 00:00:07.
    const [d1, d2] = [await dayFromToday(pool, -3), await dayFromToday(pool, -2)];
    const user = uid('t12u');
    const cohort = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1, learners: [user] });
    const born = jstDayRange(d1).end - 14 * S;
    const signals = await storeChain(pool, { user, cohort, unit: 'unit-b', from: born, n: 4 });
    const streams = (await pool.query(`SELECT to_char(s.day, 'YYYY-MM-DD') AS day, floor(extract(epoch FROM s.chain_started_at) * 1000)::bigint AS born,
        floor(extract(epoch FROM s.started_at) * 1000)::bigint AS started, (SELECT array_agg(g.seq ORDER BY g.seq) FROM training_time_signals g WHERE g.stream_id = s.id) AS seqs
        FROM training_time_streams s WHERE s.user_id = $1 ORDER BY s.day`, [user])).rows;
    const shape = streams.map((s) => `${s.day.slice(5)} [${s.seqs.join(',')}]`).join(', ');
    check('T12', streams.length === 2 && streams[0].day === d1 && streams[1].day === d2 && streams.every((s) => Number(s.born) === born)
        && Number(streams[0].started) === born && Number(streams[1].started) === born + 14 * S && shape === `${d1.slice(5)} [0,1], ${d2.slice(5)} [2,3]`,
        `a chain across 00:00 JST has one stream per day with the chain's start on both: ${shape}`);
    // The write's state of that chain (as recordSignal reads it before admitSignal): its last signal
    // over every live stream of the account, here the second day's.
    const state = (await pool.query(TRAINING_TIME_SQL.signalState, [user, cohort, signals[0].chain, 'unit-b'])).rows[0];
    const fromMidnight = (/** @type {unknown} */ ms) => `${(Number(ms) - jstDayRange(d2).start) / S} s`;
    check('T12', Number(state?.chain_seq) === 3 && Number(state?.chain_at) === signals[3].at && Number(state?.chain_born) === born,
        `the write's state (signalState) of the chain: last seq ${state?.chain_seq} at ${fromMidnight(state?.chain_at)} from 00:00 JST, born at ${fromMidnight(state?.chain_born)}`);
    const closed = /** @type {any} */ (await close(pool, user, cohort));
    const want = countDays({ fromDay: d1, toDay: d2, signals, rulesOf: () => RULES, setMsOf: () => setMsOf(unitsOf(2, 30)), carriedMs: new Map(), cohort: cohortRange(d1, d2) }).days;
    const rows = await dayRows(pool, user, cohort);
    check('T12', closed.status === 'closed' && rows.length === 2 && rows.every((row, i) => row.counted_ms === want[i].countedMs) && rows[0].counted_ms === 14 * S && rows[1].counted_ms === 7 * S,
        `closing both days equals the pure function: ${rows.map((r) => `${r.day.slice(5)} ${r.counted_ms / S} s`).join(', ')}`);
}

/** @param {pg.Pool} pool @param {{ catalogId: string }} ids */
async function t13(pool, { catalogId }) {
    // The real write on the real clock: rules whose minimum spacing is the least the rules schema
    // accepts (1 s, shared/training/timeRules.js; artificial), one chain: a first signal, a beat, a
    // stop, then nothing more of it; the rows, the answers and the GET.
    const fast = /** @type {any} */ (await loadRules({ input: { ...RULES_IN, collection: { ...RULES_IN.collection, minSpacingMs: 1 * S } }, loadedBy: 'verify', note: 'T13', pool }));
    const user = uid('t13u');
    const { cohort } = await learnerToday(pool, { catalogId, ruleSetId: String(fast.id), learners: [user] });
    const chainId = uid('chn');
    const answers = [await sendSignal(pool, user, cohort, { chainId })];
    await sleep(1200);
    answers.push(await sendSignal(pool, user, cohort, { chainId, seq: 1, input: false }));
    answers.push(await sendSignal(pool, user, cohort, { chainId, seq: 2 }));
    await sleep(1200);
    answers.push(await sendSignal(pool, user, cohort, { chainId, seq: 3, stop: true, input: false }));
    answers.push(await sendSignal(pool, user, cohort, { chainId, seq: 4 }));
    const rows = (await pool.query(`SELECT floor(extract(epoch FROM s.chain_started_at) * 1000)::bigint AS born, floor(extract(epoch FROM s.started_at) * 1000)::bigint AS started,
        g.seq, floor(extract(epoch FROM g.received_at) * 1000)::bigint AS at, g.flags
        FROM training_time_streams s JOIN training_time_signals g ON g.stream_id = s.id WHERE s.user_id = $1 ORDER BY g.seq`, [user])).rows.map((r) => ({ born: Number(r.born), started: Number(r.started), seq: r.seq, at: Number(r.at), flags: r.flags }));
    const shape = answers.map((a) => a.status === 'accepted' ? (a.state ? `accepted:${a.state.reason ?? 'counting'}` : 'accepted:-') : `${a.status}:${a.reason ?? a.error_type}`);
    const pair = rows.length === 3 ? rows[1].at - rows[0].at : NaN;
    const read = /** @type {any} */ (await readStudyTime({ userId: user, cohortId: cohort, pool }));
    check('T13', shape.join() === 'accepted:starting,accepted:counting,ignored:too_soon,accepted:-,ignored:chain_ended'
        && rows.length === 3 && rows.every((r) => r.born === rows[0].at && r.started === rows[0].at) && rows.map((r) => r.flags).join() === '6,2,3'
        && answers[1].state?.todayMs === pair && answers[0].nextInMs === 7 * S && answers[3].nextInMs === null,
        `the real write on the database clock: ${shape.join(', ')}; one stream from the first signal, flags ${rows.map((r) => r.flags).join(',')}, the beat's pair counted ${answers[1].state?.todayMs} ms`);
    check('T13', read.status === 'read' && read.time.status === 'ready' && read.time.beatMs === 7 * S && read.time.days.length === 1 && read.time.days[0].final === false
        && read.time.totalMs === answers[1].state?.todayMs + (rows[2] ? Math.min(rows[2].at - rows[1].at, 13 * S) : 0),
        `the GET's live values: ${read.time?.status}, today ${read.time?.days?.[0]?.countedMs} ms (live), total ${read.time?.totalMs} ms`);
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t14(pool, { catalogId, ruleSetId }) {
    // The clock behind a closed day: a close row of today (as a clock that went back would see it)
    // refuses the signal (503, logged) and stores nothing.
    const user = uid('t14u');
    const { cohort, today } = await learnerToday(pool, { catalogId, ruleSetId, learners: [user] });
    await pool.query(TRAINING_TIME_SQL.insertDays, [user, cohort, 'verify', [today], ['study-time/v1'], [ruleSetId], [catalogId], [0], [0], [0], ['f'.repeat(64)]]);
    const r = await sendSignal(pool, user, cohort);
    check('T14', r.status === 'clock_behind' && await streamsOf(pool, user, false) === 0, `a clock not past a closed day's evidence window stores nothing: ${r.status ?? r.error_type}`);

    // The GET (readStudyTime) closes and reads its live values under the three locks, as of one clock
    // reading: a close on another connection, started while the GET is held after its closeState
    // (before its close), or after its currentDays (its read, after its close), on whichever
    // connection the GET sends it, waits for the GET's COMMIT and then finds nothing final; the GET
    // closed both days and its total is the pure function's. Control: the GET without its learner
    // lock, held after closeState: the other close does not wait, it commits both days between the
    // GET's clock reading and the GET's own close, and the GET (which could not write them) fails.
    const d1 = await dayFromToday(pool, -3);
    const d2 = nextDay(d1);
    const runs = [];
    for (const { learnerLock, holdAfter } of [
        { learnerLock: true, holdAfter: TRAINING_TIME_SQL.closeState },
        { learnerLock: false, holdAfter: TRAINING_TIME_SQL.closeState },
        { learnerLock: true, holdAfter: TRAINING_TIME_SQL.currentDays },
    ]) {
        const learner = uid('t14r');
        const c14 = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1, learners: [learner] });
        const signals = await storeChain(pool, { user: learner, cohort: c14, unit: 'unit-b', from: jstDayRange(d2).start + 3_600_000, n: 10 });
        /** @type {Promise<any> | null} */
        let other = null;
        let otherMs = 0;
        /** @type {ConnectionChange} */
        const change = {
            ...(learnerLock ? {} : { skip: [TRAINING_SQL.learnerLock] }),
            holdAfter,
            until: async () => {
                if (other) return; // once, on whichever of its connections the GET sends the statement
                const t0 = Date.now();
                other = close(pool, learner, c14).then((r) => { otherMs = Date.now() - t0; return r; });
                await Promise.race([other, sleep(HOLD_MS)]);
            },
        };
        const changed = changedConnections(pool, [change, change]);
        const read = /** @type {any} */ (await readStudyTime({ userId: learner, cohortId: c14, pool: changed }));
        const closed = /** @type {any} */ (await other);
        const want = countDays({ fromDay: d1, toDay: d2, signals, rulesOf: () => RULES, setMsOf: () => setMsOf(unitsOf(2, 30)), carriedMs: new Map(), cohort: cohortRange(d1, d2) }).days.reduce((n, d) => n + d.countedMs, 0);
        const closers = (await pool.query('SELECT computed_by FROM training_time_days WHERE user_id = $1 AND cohort_id = $2 ORDER BY day, id', [learner, c14])).rows.map((r) => String(r.computed_by));
        runs.push({ read, closed, otherMs, want, closers });
    }
    const [locked, control, reading] = runs;
    check('T14', locked.read.status === 'read' && locked.read.time.totalMs === locked.want && locked.want > 0 && locked.read.time.days.every((/** @type {any} */ d) => d.final)
        && locked.closed?.status === 'nothing' && locked.closed.reason === 'nothing_final' && locked.otherMs >= BLOCKED_MS && locked.closers.join() === 'api,api',
        `the GET's close and read under its locks: a close started between them waited ${locked.otherMs} ms, then ${locked.closed?.status} (${locked.closed?.reason}); the GET ${locked.read.status ?? locked.read.error_type} with the days it closed (${locked.closers.join(', ')}), total ${locked.read.time?.totalMs / S} s (the pure function ${locked.want / S} s)`);
    check('T14', control.closed?.status === 'closed' && control.closed.days === 2 && control.otherMs < BLOCKED_MS && control.read.error_type === 'unknown' && control.closers.join() === 'verify,verify',
        `control, the GET without its learner lock: the other close did not wait (${control.otherMs} ms; ${control.closed?.status} ${control.closed?.days} days between the GET's clock reading and its close); the GET ${control.read.status ?? control.read.error_type}`);
    check('T14', reading.read.status === 'read' && reading.read.time.totalMs === reading.want && reading.want > 0 && reading.read.time.days.every((/** @type {any} */ d) => d.final)
        && reading.closed?.status === 'nothing' && reading.closed.reason === 'nothing_final' && reading.otherMs >= BLOCKED_MS && reading.closers.join() === 'api,api',
        `the GET's read under its locks: a close started during the read (after currentDays, the GET's close done) waited ${reading.otherMs} ms, then ${reading.closed?.status} (${reading.closed?.reason}); the GET ${reading.read.status ?? reading.read.error_type}, total ${reading.read.time?.totalMs / S} s (the pure function ${reading.want / S} s)`);
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t16(pool, { catalogId, ruleSetId }) {
    // A signal's state read that fails behind its savepoint: the real write on a connection that sends
    // the state's currentDays as a statement on a table that does not exist (42P01). The write rolls
    // back to the savepoint and commits: the signal is stored and the answer names the error. Control:
    // without the savepoint statements the failed statement aborts the transaction, its COMMIT ends it
    // as a rollback (no error from the driver), nothing is stored, and the write answers an error.
    const [kept, lost] = [uid('t16k'), uid('t16l')];
    const { cohort } = await learnerToday(pool, { catalogId, ruleSetId, learners: [kept, lost] });
    const broken = new Map([[TRAINING_TIME_SQL.currentDays, 'SELECT * FROM training_time_no_such_table']]);
    const r = await sendSignal(firstConnection(pool, { send: broken }), kept, cohort);
    const stored = await streamsOf(pool, kept, false);
    check('T16', r.status === 'accepted' && r.state === null && r.stateError === 'table_not_found' && stored === 1,
        `a state read that fails behind the savepoint: ${r.status ?? r.error_type} (stateError ${r.stateError}), streams stored ${stored}`);
    const c = await sendSignal(firstConnection(pool, { send: broken, skip: [TRAINING_TIME_SQL.savepointState, TRAINING_TIME_SQL.rollbackState] }), lost, cohort);
    const none = await streamsOf(pool, lost, false);
    check('T16', c.error_type === 'unknown' && none === 0,
        `control, without the savepoint: the COMMIT of the aborted transaction rolled it back (streams stored ${none}), and the write answered ${c.status ?? c.error_type}`);
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t15(pool, { catalogId, ruleSetId }) {
    // signalState's other columns on PostgreSQL (npm runs the signal on the in-memory fake, which
    // computes them in JavaScript): the clock guard's end of the last closed day's evidence window
    // with the widest gapMs among that day's live rows (its close's alone; then with recount rows of
    // that day: a wider one widens it, a later and narrower one does not narrow it, a marked one is
    // not read; not today's gapMs, not an earlier closed day's, even a wider recount's; a marked
    // close row and a recompute row of a later day are not read), yesterday's gapMs (not today's),
    // whether today's unit list has the unit, and each chain's last signal among the cohort's chains
    // seen yesterday or today (a chain across 00:00 by its newer stream; one of two days ago is not a
    // place).
    const gapOf = async (/** @type {number} */ gapMs) => String((/** @type {any} */ (await loadRules({ input: { ...RULES_IN, counting: { ...RULES_IN.counting, gapMs } }, loadedBy: 'verify', note: 'T15', pool }))).id);
    const [rules29, rules17, rules41, rules53, rules47] = [await gapOf(29 * S), await gapOf(17 * S), await gapOf(41 * S), await gapOf(53 * S), await gapOf(47 * S)];
    const [d3, d2, yesterday, today] = [await dayFromToday(pool, -3), await dayFromToday(pool, -2), await dayFromToday(pool, -1), await dayFromToday(pool, 0)];
    const user = uid('t15u');
    // Settings: from three days ago gapMs 23 s (RULES), from today 17 s.
    const cohort = await cohortWith(pool, { startsOn: d3, endsOn: await dayFromToday(pool, 30), catalogId, ruleSetId, from: d3, learners: [user] });
    await pool.query("INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_at, set_by, reason) VALUES ($1, $2, $3, $4::date, $5::timestamptz, 'verify', 'verify')",
        [cohort, catalogId, rules17, today, iso(jstDayRange(today).start - 86_400_000)]);
    /** A day row (counted 0) of a kind, counted with a rule set; marked an hour after it is written. */
    const dayRow = async (/** @type {string} */ day, /** @type {string} */ ruleSet, kind = 'close', marked = false) => pool.query(`INSERT INTO training_time_days
        (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, account_deleted_at, recompute_id)
        VALUES ($1, $2, $3::date, $4, 'study-time/v1', $5, $6, 0, 0, 0, $7, 'verify', ${marked ? "clock_timestamp() + interval '1 hour'" : 'NULL'}, $8)`,
    [user, cohort, day, kind, ruleSet, catalogId, 'f'.repeat(64), kind === 'recompute' ? await recountRecord(pool, cohort, day, day, ruleSet) : null]);
    await dayRow(d3, ruleSetId);
    // An earlier closed day recounted with a wider gapMs than any row of the last one: not read.
    await dayRow(d3, rules47, 'recompute');
    await dayRow(d2, rules29);
    await dayRow(yesterday, rules17, 'recompute');
    await dayRow(yesterday, rules17, 'close', true);
    /** A chain's signals ([seq, at, flags]) through the write's statements. */
    const store = async (/** @type {string} */ chain, /** @type {string} */ unit, /** @type {number} */ born, /** @type {Array<[number, number, number]>} */ signals) => {
        for (const [seq, at, flags] of signals) {
            await pool.query(TRAINING_TIME_SQL.insertStream, [user, cohort, unit, chain, iso(born), iso(at)]);
            await pool.query(TRAINING_TIME_SQL.insertSignal, [user, chain, iso(at), seq, flags]);
        }
    };
    const midnight = jstDayRange(today).start;
    const noon = jstDayRange(yesterday).start + 12 * 3_600_000;
    const early = jstDayRange(d2).start + 12 * 3_600_000;
    const [across, older, gone] = [uid('chn'), uid('chn'), uid('chn')];
    await store(across, 'unit-b', midnight - 10 * S, [[0, midnight - 10 * S, 6], [1, midnight - 3 * S, 6], [2, midnight + 4 * S, 7]]);
    await store(older, 'unit-a', noon, [[0, noon, 6], [1, noon + 7 * S, 4]]);
    await store(gone, 'unit-a', early, [[0, early, 6], [1, early + 7 * S, 6]]);
    const state = (await pool.query(TRAINING_TIME_SQL.signalState, [user, cohort, across, 'unit-b'])).rows[0];
    const unknown = (await pool.query(TRAINING_TIME_SQL.signalState, [user, cohort, across, 'unit-zzz'])).rows[0];
    const until = Number(state?.closed_until_ms) - jstDayRange(d2).end;
    check('T15', state?.last_closed === d2 && until === 29 * S,
        `the clock guard: the last closed day ${state?.last_closed} (${d2} expected) and its window's end ${until / S} s after its end (its own gapMs 29 s; not today's 17 s, nor an earlier day's recount's 47 s)`);
    // Recount rows of that day, in this order: one counted with a wider gapMs, one with a wider one
    // still that an account deletion marked, and the day's current row, counted with a narrower one.
    await dayRow(d2, rules41, 'recompute');
    await dayRow(d2, rules53, 'recompute', true);
    await dayRow(d2, rules17, 'recompute');
    const widened = (await pool.query(TRAINING_TIME_SQL.signalState, [user, cohort, across, 'unit-b'])).rows[0];
    const widenedBy = Number(widened?.closed_until_ms) - jstDayRange(d2).end;
    check('T15', widened?.last_closed === d2 && widenedBy === 41 * S,
        `with recount rows of that day: its window's end ${widenedBy / S} s after its end (the widest gapMs of its live rows, a recount's 41 s; a marked recount's 53 s not read; the current row, a later recount's 17 s, does not narrow it)`);
    check('T15', Number(state?.yesterday_gap_ms) === 23 * S && Number(state?.params?.counting?.gapMs) === 17 * S && state?.unit_known === true && unknown?.unit_known === false,
        `yesterday's gapMs ${Number(state?.yesterday_gap_ms) / S} s (23 s), today's ${Number(state?.params?.counting?.gapMs) / S} s (17 s); today's unit list has unit-b: ${state?.unit_known}, unit-zzz: ${unknown?.unit_known}`);
    const want = [{ chain_id: across, born: midnight - 10 * S, at: midnight + 4 * S, flags: 7 }, { chain_id: older, born: noon, at: noon + 7 * S, flags: 4 }]
        .sort((x, y) => (x.chain_id < y.chain_id ? -1 : 1));
    const places = (Array.isArray(state?.places) ? state.places : []).map((/** @type {any} */ p) => ({ chain_id: String(p.chain_id), born: Number(p.born), at: Number(p.at), flags: Number(p.flags) }));
    const jstTime = (/** @type {number} */ ms) => `${jstDayOf(ms).slice(5)} ${new Date(ms + 9 * 3_600_000).toISOString().slice(11, 19)}`;
    check('T15', JSON.stringify(places) === JSON.stringify(want) && Number(state?.chain_seq) === 2 && Number(state?.chain_at) === midnight + 4 * S && Number(state?.chain_flags) === 7,
        `the places (${places.length} of 3 chains): ${places.map((p) => `${p.chain_id === across ? 'the chain across 00:00' : p.chain_id === older ? 'yesterday\'s' : 'two days ago\'s'} at ${jstTime(p.at)} JST, flags ${p.flags}`).join('; ')}; the chain's last seq ${state?.chain_seq}`);
}

/** @param {pg.Pool} pool @param {string} cohort */
const slugOf = async (pool, cohort) => String((await pool.query('SELECT slug FROM training_cohorts WHERE id = $1', [cohort])).rows[0].slug);
/** The check's answer, one line per learner: the account id, its days, then each difference as day:what. @param {any} r @returns {string[]} */
const checkedLines = (r) => (r?.status === 'checked'
    ? r.learners.map((/** @type {any} */ l) => [l.userId, l.days, ...l.differences.map((/** @type {any} */ d) => `${d.day}:${d.what}`)].join(' '))
    : [String(r?.status ?? r?.error_type)]);
/** The differences of a one-learner answer (after the account id and its days). @param {string[]} lines */
const foundIn = (lines) => lines.join().split(' ').slice(2).join(', ') || 'none';

/** An account deletion (the service's statements up to the stub), committed on its own connection. @param {pg.Pool} pool @param {string} id */
async function deleteNow(pool, id) {
    const c = await pool.connect();
    try {
        await deletionUpToStub(c, id);
        await c.query('COMMIT');
    } catch (error) {
        await c.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        c.release();
    }
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t17(pool, { catalogId, ruleSetId }) {
    // 023's constraints: a recount row names a recount of its own cohort (the composite foreign key),
    // a close row none (the CHECK); a recount's record never changes and names an override.
    const [d1, d2] = [await dayFromToday(pool, -3), await dayFromToday(pool, -2)];
    const manifest = unitsOf(2, 30);
    manifest.units.push({ key: 'unit1', title: { jp: '1', en: '1' }, setMinutes: 30 });
    const keys = String(/** @type {any} */ (await loadCatalog({ input: manifest, loadedBy: 'verify', note: 'T17', pool })).id);
    const user = uid('t17u');
    const cohort = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId: keys, ruleSetId, from: d1, learners: [user] });
    const other = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1 });
    const [mine, theirs] = [await recountRecord(pool, cohort, d1, d1, ruleSetId), await recountRecord(pool, other, d1, d1, ruleSetId)];
    const dayWith = (/** @type {string} */ kind, /** @type {string | null} */ recount) => codeOf(pool, `INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
        VALUES ($1, $2, $3::date, $4, 'study-time/v1', $5, $6, 0, 0, 0, repeat('f', 64), 'verify', $7)`, [uid('t17x'), cohort, d1, kind, ruleSetId, catalogId, recount]);
    const named = [await dayWith('close', mine), await dayWith('recompute', null), await dayWith('recompute', theirs), await dayWith('recompute', String(Number(mine) + 1_000_000)),
        await dayWith('recompute', mine), await dayWith('close', null)];
    check('T17', named.join() === '23514,23514,23503,23503,ok,ok',
        `a day row and its recount: a close naming one ${named[0]}, a recount naming none ${named[1]}, another cohort's recount ${named[2]}, no such recount ${named[3]}; a recount of its own cohort ${named[4]}, a close naming none ${named[5]}`);
    const record = (/** @type {string} */ from, /** @type {string} */ to, /** @type {string | null} */ rules, /** @type {string | null} */ catalog, sha = 'a'.repeat(64)) => codeOf(pool,
        `INSERT INTO training_time_recomputes (cohort_id, from_day, to_day, rule_set_id, catalog_version_id, plan_sha256, recomputed_by, reason)
        VALUES ($1, $2::date, $3::date, $4, $5, $6, 'verify', 'verify')`, [cohort, from, to, rules, catalog, sha]);
    const records = [await record(d1, d2, null, catalogId), await record(d2, d2, ruleSetId, null), await record(d2, d1, ruleSetId, null), await record(d1, d2, null, null),
        await record(d1, d2, ruleSetId, null, 'A'.repeat(64))];
    const changes = [await codeOf(pool, "UPDATE training_time_recomputes SET reason = 'x' WHERE id = $1", [mine]), await codeOf(pool, 'DELETE FROM training_time_recomputes WHERE id = $1', [mine])];
    check('T17', records.join() === 'ok,ok,23514,23514,23514' && changes.join() === '23001,23001',
        `a recount's record: a unit list only ${records[0]}, rules only ${records[1]}; its days backwards ${records[2]}, no override ${records[3]}, the plan's sha256 in upper case ${records[4]}; UPDATE ${changes[0]}, DELETE ${changes[1]} (rp_rows_immutable)`);

    // The check on PostgreSQL. The cohort's unit list has 'unit1' too: on the second day three units,
    // which the VM's and CI's collation (en_US.utf8 ignores '-') returns in another order (unit1
    // unit-a unit-b) than the code's (unit-a unit-b unit1); the check runs once more with the unit
    // rows in reverse order, so any cluster proves it. Two days closed by the core: unit-a on both (its
    // set time, 2 min, reached on the first), unit1, a chain on unit-b out of the second day across
    // 00:00 JST, its last signal 26 s after it, and a lone signal 120 s before the first day. Then a
    // recount of both with other rules (smaller pieces, evidence read further back and ahead: those
    // two signals are in the days' windows now) as a recount writes it: the override and the replaced
    // rows' unit list, the second day with the first's new unit time carried.
    const start = (/** @type {string} */ day) => jstDayRange(day).start;
    const signals = [
        ...await storeChain(pool, { user, cohort, unit: 'unit-b', from: start(d1) - 120 * S, n: 1 }),
        ...await storeChain(pool, { user, cohort, unit: 'unit-a', from: start(d1) + 10 * 3_600_000, n: 20 }),
        ...await storeChain(pool, { user, cohort, unit: 'unit-a', from: start(d2) + 9 * 3_600_000, n: 20 }),
        ...await storeChain(pool, { user, cohort, unit: 'unit1', from: start(d2) + 11 * 3_600_000, n: 12 }),
        ...await storeChain(pool, { user, cohort, unit: 'unit-b', from: jstDayRange(d2).end - 40 * S, n: 12, every: 6 * S }),
    ];
    const closed = /** @type {any} */ (await close(pool, user, cohort));
    const slug = await slugOf(pool, cohort);
    const verified = async () => checkedLines(await verifyCohort({ cohortSlug: slug, pool }));
    const collated = String((await pool.query(`SELECT string_agg(u.unit_key, ' ' ORDER BY u.unit_key) AS k
        FROM training_time_unit_days u JOIN training_time_days d ON d.id = u.day_id WHERE d.user_id = $1 AND d.day = $2::date`, [user, d2])).rows[0].k);
    const afterClose = await verified();
    // The learner's snapshot is the check's second connection (its first reads the cohort).
    const reversedSql = CHECK_SQL.unitRows.replace(/ unit_key$/, ' unit_key DESC');
    const reversed = reversedSql === CHECK_SQL.unitRows ? ['the unit rows statement changed'] : checkedLines(await verifyCohort({ cohortSlug: slug,
        pool: changedConnections(pool, [{}, { send: new Map([[CHECK_SQL.unitRows, reversedSql]]) }]) }));
    const rules2 = String(/** @type {any} */ (await loadRules({ input: RULES_IN_2, loadedBy: 'verify', note: 'T17', pool })).id);
    const recount = await recountRecord(pool, cohort, d1, d2, rules2);
    const want = countDays({ fromDay: d1, toDay: d2, signals, rulesOf: () => RULES_2, setMsOf: () => setMsOf(manifest), carriedMs: new Map(), cohort: cohortRange(d1, d2) }).days;
    /** @type {string[]} */
    const recountRows = [];
    for (const [i, day] of [d1, d2].entries()) {
        const w = evidenceWindow(start(day), jstDayRange(day).end, RULES_2.counting);
        const evidence = signals.filter((s) => s.at >= w.from && s.at <= w.to);
        const units = want[i].units.filter((u) => u.countedMs > 0 || u.overCapMs > 0);
        const id = String((await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
            VALUES ($1, $2, $3::date, 'recompute', 'study-time/v1', $4, $5, $6, $7, $8, $9, 'verify', $10) RETURNING id`,
        [user, cohort, day, rules2, keys, want[i].countedMs, units.reduce((n, u) => n + u.overCapMs, 0), evidence.length, evidenceDigest(evidence), recount])).rows[0].id);
        for (const u of units) await pool.query('INSERT INTO training_time_unit_days (day_id, unit_key, counted_ms, over_cap_ms) VALUES ($1, $2, $3, $4)', [id, u.unit, u.countedMs, u.overCapMs]);
        recountRows.push(id);
    }
    const afterRecount = await verified();
    await pool.query('UPDATE training_time_days SET counted_ms = counted_ms + 1000 WHERE id = $1', [recountRows[1]]);
    const tampered = await verified();
    await pool.query('UPDATE training_time_days SET counted_ms = counted_ms - 1000 WHERE id = $1', [recountRows[1]]);
    await pool.query("UPDATE training_time_days SET algorithm = 'study-time/v9' WHERE id = $1", [recountRows[0]]);
    const unknown = await verified();
    await pool.query("UPDATE training_time_days SET algorithm = 'study-time/v1' WHERE id = $1", [recountRows[0]]);
    const rowsNow = await dayRows(pool, user, cohort);
    const old = rowsNow.filter((r) => r.kind === 'close').map((r) => `${r.counted_ms / S}+${r.over_cap_ms / S}`);
    const fresh = want.map((d) => `${d.countedMs / S}+${d.units.reduce((n, u) => n + u.overCapMs, 0) / S}`);
    // Each day's evidence: the close's (R1) and the recount's (R2: one more signal, before 00:00 of
    // the first day and after 00:00 of the second).
    const read = [d1, d2].map((day) => rowsNow.filter((r) => r.day === day).map((r) => r.signals));
    const matches = (/** @type {string[]} */ lines) => (lines.join() === `${user} 2` ? 'match' : lines.join());
    check('T17', closed.status === 'closed' && afterClose.join() === `${user} 2` && reversed.join() === `${user} 2` && afterRecount.join() === `${user} 2`
        && old.join() !== fresh.join() && want[1].units.length === 3 && read.every((r) => r.length === 2 && r[1] === r[0] + 1)
        && tampered.join() === `${user} 2 ${d2}:values` && unknown.join() === `${user} 2 ${d1}:version`,
        `the check on PostgreSQL: the closed days (${old.join(', ')} s) ${matches(afterClose)} (the second day's units as this database orders them: ${collated}; in reverse order: ${matches(reversed)}); recounted with other rules (${fresh.join(', ')} s; evidence ${read.map((r) => r.join(' then ')).join(', ')} signals) ${matches(afterRecount)}; a changed value: ${foundIn(tampered)}; a version this code does not have: ${foundIn(unknown)}`);

    // The deletion's marks reach the recount rows (the foreign key and the CHECK in place); the record
    // stays and the rows still name it; the check then has no learner to read.
    await deleteNow(pool, user);
    const marks = (await pool.query(`SELECT count(*) FILTER (WHERE account_deleted_at IS NOT NULL) AS marked, count(*) FILTER (WHERE account_deleted_at IS NULL) AS live,
        count(*) FILTER (WHERE recompute_id = $3) AS named FROM training_time_days WHERE user_id = $1 AND cohort_id = $2`, [user, cohort, recount])).rows[0];
    const kept = await count(pool, 'SELECT count(*) AS n FROM training_time_recomputes WHERE id = $1', [recount]);
    const afterDeletion = await verified();
    check('T17', Number(marks.marked) === 4 && Number(marks.live) === 0 && Number(marks.named) === 2 && kept === 1 && afterDeletion.length === 0,
        `an account deletion marks the close and recount rows (${marks.marked} marked, ${marks.live} live; ${marks.named} still name the recount); its record stays (${kept}); the check then reads ${afterDeletion.length} learners`);
}

/**
 * On a connection of its own, in a transaction begun with `begin` (the check's snapshot unless
 * given): `run`, then what `measure` finds, then a rollback.
 * @template T @param {pg.Pool} pool @param {(c: pg.PoolClient) => Promise<unknown>} run @param {(c: pg.PoolClient) => Promise<T>} measure
 * @param {string} [begin] @returns {Promise<T>}
 */
async function inSnapshot(pool, run, measure, begin = TRAINING_TIME_SQL.beginSnapshot) {
    const c = await pool.connect();
    try {
        await c.query(begin);
        await run(c);
        return await measure(c);
    } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
    }
}
/** Sends the statements, in order. @param {readonly string[]} statements */
const sending = (statements) => async (/** @type {pg.PoolClient} */ c) => {
    for (const sql of statements) await c.query(sql);
};
/** The tables (relkind r or p) this backend holds a lock on, by name. @param {pg.PoolClient} c @returns {Promise<string[]>} */
const tablesLocked = async (c) => (await c.query(`SELECT coalesce(array_agg(DISTINCT c.oid::regclass::text ORDER BY c.oid::regclass::text), '{}') AS t
    FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
   WHERE l.locktype = 'relation' AND l.pid = pg_backend_pid() AND c.relkind IN ('r', 'p')
     AND c.relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)`)).rows[0].t;
/** Of the indexes of `tables`, how many this backend holds a lock on: 'held of all'. @param {string[]} tables */
const indexesLocked = (tables) => async (/** @type {pg.PoolClient} */ c) => {
    const n = (await c.query(`SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_locks l
        WHERE l.locktype = 'relation' AND l.relation = i.indexrelid AND l.pid = pg_backend_pid()))::int AS held, count(*)::int AS total
      FROM pg_index i WHERE i.indrelid = ANY($1::regclass[])`, [tables])).rows[0];
    return `${n.held} of ${n.total}`;
};
/** 'n of n' with n > 0: every one of them. @param {string} n */
const every = (n) => /^([1-9]\d*) of \1$/.test(n);
/** The same tables, in any order. @param {string[]} a @param {string[]} b */
const sameTables = (a, b) => [...a].sort().join() === [...b].sort().join();
/** @param {string[]} reads @param {string[]} locks */
const same = (reads, locks) => (sameTables(reads, locks) ? 'are those its LOCK locks' : `${reads.join()}, its LOCK's ${locks.join()}`);

/**
 * PostgreSQL's table lock modes in its own order (lock.h), the weakest first. A recount takes only the
 * first three, each of which conflicts with every mode the ones before it conflict with.
 */
const LOCK_MODES = Object.freeze(['AccessShareLock', 'RowShareLock', 'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock']);
/**
 * The tables (relkind r or p) a backend holds a lock on, each with the strongest mode it holds, in
 * code-unit order of their names: the backend with `pid`, or (null) this connection's.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<any> }} db @param {number | null} pid
 * @returns {Promise<Map<string, string>>}
 */
async function modesHeld(db, pid) {
    if (pid !== null && !Number.isInteger(pid)) throw new Error('modesHeld: the connection has no backend pid');
    const { rows } = await db.query(`SELECT c.oid::regclass::text AS t, l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
        WHERE l.locktype = 'relation' AND l.granted AND l.pid = coalesce($1::int, pg_backend_pid()) AND c.relkind IN ('r', 'p')
          AND c.relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)`, [pid]);
    /** @type {Map<string, string>} */
    const strongest = new Map();
    for (const row of rows) {
        const [table, mode] = [String(row.t), String(row.mode)];
        if (LOCK_MODES.indexOf(mode) > LOCK_MODES.indexOf(strongest.get(table) ?? '')) strongest.set(table, mode);
    }
    return new Map([...strongest].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t18(pool, { catalogId, ruleSetId }) {
    // The check reads each learner in one snapshot (REPEATABLE READ READ ONLY, no advisory lock): an
    // account deletion committing between its read of the rows and its read of the evidence (which
    // takes live streams only) changes nothing it reports. Control: the same check with a plain BEGIN
    // (READ COMMITTED) finds no evidence for the learner's days, so every day differs.
    const [d1, d2] = [await dayFromToday(pool, -3), await dayFromToday(pool, -2)];
    const start = (/** @type {string} */ day) => jstDayRange(day).start;
    /** A learner alone in a cohort, with study on both days, closed. @param {string} tag */
    const closedLearner = async (tag) => {
        const user = uid(tag);
        const cohort = await cohortWith(pool, { startsOn: d1, endsOn: d2, catalogId, ruleSetId, from: d1, learners: [user] });
        await storeChain(pool, { user, cohort, unit: 'unit-a', from: start(d1) + 10 * 3_600_000, n: 12 });
        await storeChain(pool, { user, cohort, unit: 'unit-b', from: start(d2) + 10 * 3_600_000, n: 12 });
        const closed = /** @type {any} */ (await close(pool, user, cohort));
        return { user, slug: await slugOf(pool, cohort), closed: String(closed.status) };
    };
    const [x, z] = [await closedLearner('t18x'), await closedLearner('t18z')];
    // The check's snapshot as PostgreSQL runs it: REPEATABLE READ and read only (a write is refused).
    const c = await pool.connect();
    /** @type {any} */
    let mode = null;
    let write = 'ok';
    try {
        await c.query(TRAINING_TIME_SQL.beginSnapshot);
        mode = (await c.query("SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro")).rows[0];
        write = await c.query('INSERT INTO auth.users (id) VALUES ($1::uuid)', [uid('t18p')]).then(() => 'ok', (error) => String(error.code));
    } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
    }
    check('T18', mode?.iso === 'repeatable read' && mode?.ro === 'on' && write === '25006', `the check's snapshot: ${mode?.iso}, read only ${mode?.ro}; a write in it: ${write}`);
    /**
     * The check of a learner's cohort with the learner's deletion committed after its read of the rows
     * (its second connection: the first reads the cohort). @param {{ user: string, slug: string }} l @param {Map<string, string>} send
     */
    const deletedDuring = async (l, send) => checkedLines(await verifyCohort({ cohortSlug: l.slug,
        pool: changedConnections(pool, [{}, { send, after: CHECK_SQL.learnerRows, run: () => deleteNow(pool, l.user) }]) }));
    const live = (/** @type {string} */ user) => count(pool, 'SELECT count(*) AS n FROM training_time_days WHERE user_id = $1 AND account_deleted_at IS NULL', [user]);
    const snapshot = await deletedDuring(x, new Map());
    const xLive = await live(x.user);
    check('T18', x.closed === 'closed' && snapshot.join() === `${x.user} 2` && xLive === 0,
        `an account deletion committed between the check's read of the rows and of the evidence (then ${xLive} live day rows): in its snapshot the check reports ${snapshot.join() === `${x.user} 2` ? 'both days matching' : snapshot.join()}`);
    const control = await deletedDuring(z, new Map([[TRAINING_TIME_SQL.beginSnapshot, 'BEGIN']]));
    const zLive = await live(z.user);
    check('T18', z.closed === 'closed' && control.join() === `${z.user} 2 ${d1}:evidence ${d1}:values ${d2}:evidence ${d2}:values` && zLive === 0,
        `control, a plain BEGIN: the same deletion (then ${zLive} live day rows) makes every day differ: ${foundIn(control)}`);

    // A migration's table rewrite (not MVCC-safe) held HOLD_MS, then committed, while the check runs:
    // the check's LOCK … NOWAIT fails while the table is held, so it tries again, holding nothing (no
    // backend waits on a lock meanwhile), and its snapshot reads the rewritten table whole. Control:
    // without the LOCK and the 20 ms limit (so the wait lasts the whole hold), the try's read of no
    // rows takes its snapshot, then waits for the rewritten table, and sees it empty: the gap, up to
    // 20 ms a try, that the LOCK closes. The days' table for a learner's snapshot; the memberships for
    // the cohort's, whose control reads no learner (so it would report a cohort it did not check).
    const [y, w, ya, wa] = [await closedLearner('t18y'), await closedLearner('t18w'), await closedLearner('t18ya'), await closedLearner('t18wa')];
    /** The statements waiting on a lock, of the other connections. */
    const waitingOnLocks = async () => (await pool.query(`SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`)).rows.map((r) => String(r.query));
    /**
     * The check of a learner's cohort while `rewrite` is held HOLD_MS, then committed. `changes` for its
     * connections (the cohort's first try, then the first learner's); `lock`, the LOCK whose tries count.
     * @param {{ slug: string }} l @param {string} rewrite @param {ConnectionChange[]} changes @param {string} lock
     */
    const rewrittenDuring = async (l, rewrite, changes, lock) => {
        const ddl = await pool.connect();
        const recorded = recordingPool(pool);
        try {
            await ddl.query('BEGIN');
            await ddl.query(rewrite);
            const checking = verifyCohort({ cohortSlug: l.slug, pool: changedConnections(recorded.pool, changes) });
            await sleep(HOLD_MS);
            const waiting = await waitingOnLocks();
            await ddl.query('COMMIT');
            const lines = checkedLines(await checking);
            return { lines, waiting, tries: recorded.sent.filter((sql) => sql === lock).length };
        } catch (error) {
            await ddl.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            ddl.release();
        }
    };
    const rewriteDays = 'ALTER TABLE training_time_days ALTER COLUMN signals TYPE integer USING signals + 0';
    const locked = await rewrittenDuring(y, rewriteDays, [], CHECK_SQL.lockLearner);
    check('T18', y.closed === 'closed' && locked.lines.join() === `${y.user} 2` && locked.waiting.length === 0 && locked.tries >= 2,
        `a table rewrite held ${HOLD_MS} ms, then committed: the check tried its LOCK ${locked.tries} times, ${locked.waiting.length === 0 ? 'no backend waiting on a lock' : `while ${locked.waiting.length} statement(s) waited on a lock (${locked.waiting.map((q) => (q === CHECK_SQL.lockLearner ? 'its LOCK' : q.slice(0, 60))).join(' | ')})`}, then ${locked.lines.join() === `${y.user} 2` ? 'read both days, matching' : locked.lines.join()}`);
    const unlocked = await rewrittenDuring(w, rewriteDays, [{}, { skip: [CHECK_SQL.lockLearner, CHECK_SQL.tryLockTimeout] }], CHECK_SQL.lockLearner);
    check('T18', w.closed === 'closed' && unlocked.lines.join() === `${w.user} 0` && unlocked.waiting.join() === CHECK_SQL.indexesLearner,
        `control, without the LOCK and its 20 ms limit: the check waited in ${unlocked.waiting.join() === CHECK_SQL.indexesLearner ? 'its read of no rows, after its snapshot' : `${unlocked.waiting.length} statements`}, which reads ${unlocked.lines.join().split(' ')[1] ?? '?'} days of the rewritten table`);
    const rewriteMemberships = "ALTER TABLE training_memberships ALTER COLUMN role TYPE text USING role || ''";
    const cohortLocked = await rewrittenDuring(ya, rewriteMemberships, [], CHECK_SQL.lockCohort);
    const cohortUnlocked = await rewrittenDuring(wa, rewriteMemberships, [{ skip: [CHECK_SQL.lockCohort, CHECK_SQL.tryLockTimeout] }], CHECK_SQL.lockCohort);
    check('T18', ya.closed === 'closed' && cohortLocked.lines.join() === `${ya.user} 2` && cohortLocked.waiting.length === 0 && cohortLocked.tries >= 2
        && wa.closed === 'closed' && cohortUnlocked.lines.length === 0 && cohortUnlocked.waiting.join() === CHECK_SQL.indexesCohort,
        `the cohort's snapshot, the memberships rewritten: the check tried its LOCK ${cohortLocked.tries} times, ${cohortLocked.waiting.length === 0 ? 'no backend waiting on a lock' : `while ${cohortLocked.waiting.length} statement(s) waited on a lock (${cohortLocked.waiting.map((s) => (s === CHECK_SQL.lockCohort ? 'its LOCK' : s.slice(0, 60))).join(' | ')})`}, then ${matchesTwo(cohortLocked.lines, ya.user)}; control, without the LOCK and its 20 ms limit: it waited in ${cohortUnlocked.waiting.join() === CHECK_SQL.indexesCohort ? 'its read of no rows, after its snapshot' : `${cohortUnlocked.waiting.length} statements`}, then read ${cohortUnlocked.lines.length === 0 ? 'no learner' : cohortUnlocked.lines.join()}`);

    // A migration that changes two of the tables a snapshot locks, in the other order than its LOCK,
    // or that rebuilds an index of one (REINDEX holds the index in ACCESS EXCLUSIVE mode, and its table
    // only in SHARE mode, which the LOCK's ACCESS SHARE does not conflict with) and then alters
    // another: its first statement held while the check starts, the second HOLD_MS later. The check
    // waits at most 20 ms while it holds a lock, so the migration's second statement goes through (no
    // deadlock), and the check reads the learner's days once the migration ends. Controls: a LOCK
    // that waits (no NOWAIT) holds the tables before the one it waits for; a try without its shorter
    // lock timeout and read of no rows waits in a read for the index while it holds its tables: either
    // way PostgreSQL cancels the migration (40P01). The index case for the cohort's snapshot too (an
    // index of the memberships rebuilt, then the cohorts altered).
    const [v, u, t, r, q, ra, qa] = [await closedLearner('t18v'), await closedLearner('t18u'), await closedLearner('t18t'), await closedLearner('t18r'), await closedLearner('t18q'),
        await closedLearner('t18ra'), await closedLearner('t18qa')];
    const addProbe = (/** @type {string} */ table) => `ALTER TABLE ${table} ADD COLUMN t18_probe integer`;
    /**
     * @param {{ slug: string }} l @param {string} first @param {string} second
     * @param {ConnectionChange[]} [changes] for the check's connections (the cohort's first try, then the first learner's)
     */
    const migrationDuring = async (l, first, second, changes = []) => {
        const ddl = await pool.connect();
        try {
            await ddl.query('BEGIN');
            await ddl.query(first);
            const checking = verifyCohort({ cohortSlug: l.slug, pool: changedConnections(pool, changes) });
            await sleep(HOLD_MS);
            const migrated = await ddl.query(second).then(() => 'ok', (error) => String(error.code));
            await ddl.query('ROLLBACK');
            return { migrated, lines: checkedLines(await checking) };
        } catch (error) {
            await ddl.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            ddl.release();
        }
    };
    const cohortShape = await migrationDuring(v, addProbe('training_memberships'), addProbe('training_cohorts'));
    const learnerShape = await migrationDuring(u, addProbe('training_time_recomputes'), addProbe('training_time_days'));
    const reindexShape = await migrationDuring(r, 'REINDEX INDEX training_time_days_cohort_idx', addProbe('training_time_recomputes'));
    check('T18', cohortShape.migrated === 'ok' && cohortShape.lines.join() === `${v.user} 2` && learnerShape.migrated === 'ok' && learnerShape.lines.join() === `${u.user} 2`
        && reindexShape.migrated === 'ok' && reindexShape.lines.join() === `${r.user} 2`,
        `a migration altering the memberships, then the cohorts: its second ALTER ${cohortShape.migrated}, the check ${matchesTwo(cohortShape.lines, v.user)}; the recounts' table, then the days': ${learnerShape.migrated}, ${matchesTwo(learnerShape.lines, u.user)}; an index of the days' rebuilt, then the recounts' table altered: ${reindexShape.migrated}, ${matchesTwo(reindexShape.lines, r.user)}`);
    const waitingLock = await migrationDuring(t, addProbe('training_time_recomputes'), addProbe('training_time_days'), [{}, { send: new Map([[CHECK_SQL.lockLearner, CHECK_SQL.lockLearner.replace(/ NOWAIT$/, '')]]) }]);
    const waitingRead = await migrationDuring(q, 'REINDEX INDEX training_time_days_cohort_idx', addProbe('training_time_recomputes'), [{}, { skip: [CHECK_SQL.tryLockTimeout, CHECK_SQL.indexesLearner] }]);
    check('T18', waitingLock.migrated === '40P01' && waitingLock.lines.join() === `${t.user} 2` && waitingRead.migrated === '40P01' && waitingRead.lines.join() === `${q.user} 2`,
        `controls: a LOCK that waits, the migration's second ALTER ${waitingLock.migrated === '40P01' ? 'is cancelled as a deadlock (40P01)' : waitingLock.migrated}, the check then ${matchesTwo(waitingLock.lines, t.user)}; a read that waits for the index, ${waitingRead.migrated === '40P01' ? 'the same (40P01)' : waitingRead.migrated}, ${matchesTwo(waitingRead.lines, q.user)}`);
    const reindexMemberships = 'REINDEX INDEX training_memberships_cohort_idx';
    const cohortReindex = await migrationDuring(ra, reindexMemberships, addProbe('training_cohorts'));
    const cohortWaitingRead = await migrationDuring(qa, reindexMemberships, addProbe('training_cohorts'), [{ skip: [CHECK_SQL.tryLockTimeout, CHECK_SQL.indexesCohort] }]);
    check('T18', cohortReindex.migrated === 'ok' && cohortReindex.lines.join() === `${ra.user} 2` && cohortWaitingRead.migrated === '40P01' && cohortWaitingRead.lines.join() === `${qa.user} 2`,
        `the cohort's snapshot, an index of the memberships rebuilt, then the cohorts altered: ${cohortReindex.migrated}, the check ${matchesTwo(cohortReindex.lines, ra.user)}; control, its read waiting for the index: ${cohortWaitingRead.migrated === '40P01' ? 'the migration is cancelled as a deadlock (40P01)' : cohortWaitingRead.migrated}, ${matchesTwo(cohortWaitingRead.lines, qa.user)}`);

    // What each snapshot's statements lock (pg_locks, this backend's). Its reads, without its LOCK (a
    // renamed table too): exactly the tables its LOCK locks, for the cohort and for a learner with a
    // recount row (every read of readLearner). Its opening statements: every index of those tables as
    // well (the read of no rows); control: the LOCK and the 20 ms limit alone, none.
    const p = await closedLearner('t18p');
    const cohortId = String((await pool.query('SELECT id FROM training_cohorts WHERE slug = $1', [p.slug])).rows[0].id);
    await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
        SELECT user_id, cohort_id, day, 'recompute', algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, 'verify', $3
          FROM training_time_days WHERE user_id = $1 AND day = $2::date AND kind = 'close'`, [p.user, d1, await recountRecord(pool, cohortId, d1, d1, ruleSetId)]);
    const lockOf = { cohort: await inSnapshot(pool, sending([CHECK_SQL.lockCohort]), tablesLocked), learner: await inSnapshot(pool, sending([CHECK_SQL.lockLearner]), tablesLocked) };
    const cohortReads = await inSnapshot(pool, (c) => readCohort(c, p.slug), tablesLocked);
    let rows = 0;
    const learnerReads = await inSnapshot(pool, async (c) => {
        await c.query(TRAINING_TIME_SQL.closeSettings, [cohortId]);
        rows = (await readLearner(c, p.user, cohortId)).rows.length;
    }, tablesLocked);
    check('T18', cohortReads.join() === lockOf.cohort.join() && learnerReads.join() === lockOf.learner.join() && rows === 3,
        `the tables the reads lock: the cohort's ${same(cohortReads, lockOf.cohort)}; a learner's with a recount row (${rows} rows) ${same(learnerReads, lockOf.learner)}`);
    const indexes = {
        cohort: await inSnapshot(pool, sending(SNAPSHOT_LOCKS.cohort), indexesLocked(lockOf.cohort)),
        learner: await inSnapshot(pool, sending(SNAPSHOT_LOCKS.learner), indexesLocked(lockOf.learner)),
        lockAlone: await inSnapshot(pool, sending([CHECK_SQL.lockLearner, CHECK_SQL.tryLockTimeout]), indexesLocked(lockOf.learner)),
    };
    check('T18', every(indexes.cohort) && every(indexes.learner) && /^0 of [1-9]\d*$/.test(indexes.lockAlone),
        `the indexes of those tables a try's opening statements lock (its read of no rows): the cohort's ${indexes.cohort}, a learner's ${indexes.learner}; control, the LOCK and the 20 ms limit alone: ${indexes.lockAlone}`);
}

/**
 * A T19 learner's study, chains of [day (0: the cohort's first), unit, signals 7 s apart from 10:00
 * JST]. FULL: unit-a's whole set time on the first day, a little more on the second, more on the
 * third, so a recount of the first day with RULES_2 (smaller pieces, under the set time) changes the
 * other two through the carry. UNIT_B: unit-b on the second day only, so that recount changes its
 * first day's versions alone.
 * @typedef {ReadonlyArray<readonly [number, string, number]>} Study
 */
/** @type {Study} */
const FULL = [[0, 'unit-a', 20], [1, 'unit-a', 4], [2, 'unit-a', 12]];
/** @type {Study} */
const UNIT_B = [[1, 'unit-b', 12]];

/** Code-unit order of [key, counted, over] rows (not a database collation's). @param {[string, number, number]} x @param {[string, number, number]} y */
const byKey = (x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
/** A day row's unit rows as [unit, counted, over], in code-unit order. @param {pg.Pool} pool @param {string} dayId */
const unitRowsOf = async (pool, dayId) => (await pool.query('SELECT unit_key, counted_ms, over_cap_ms FROM training_time_unit_days WHERE day_id = $1', [dayId])).rows
    .map((/** @type {any} */ r) => /** @type {[string, number, number]} */ ([String(r.unit_key), Number(r.counted_ms), Number(r.over_cap_ms)])).sort(byKey);
/** A cohort's recount records. @param {pg.Pool} pool @param {string} cohort */
const recordsOf = (pool, cohort) => count(pool, 'SELECT count(*) AS n FROM training_time_recomputes WHERE cohort_id = $1', [cohort]);
/** @param {number} n */
const tried = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;

/**
 * T19's days (four to two days ago: final once the 00:00 JST guard has run) and versions: T2's unit
 * list and rules, the override of every recount here (RULES_2; its version, as the dry run reads it)
 * and the rules from each cohort's third day (RULES_3).
 * @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids
 */
async function t19Versions(pool, { catalogId, ruleSetId }) {
    const days = [await dayFromToday(pool, -4), await dayFromToday(pool, -3), await dayFromToday(pool, -2)];
    const catalog = /** @type {any} */ (await loadCatalog({ input: unitsOf(2, 30), loadedBy: 'verify', note: 'T19', pool }));
    const rules2 = /** @type {any} */ (await loadRules({ input: RULES_IN_2, loadedBy: 'verify', note: 'T19', pool }));
    const rules3 = /** @type {any} */ (await loadRules({ input: RULES_IN_3, loadedBy: 'verify', note: 'T19', pool }));
    const override = rulesVersionOf((await pool.query(RECOUNT_SQL.rulesBySha, [rules2.sha256])).rows[0]);
    if (String(catalog.id) !== catalogId || !override.rules || !rules3.id) throw new Error('T19: the versions could not be loaded');
    return { days, catalogId, ruleSetId, catalogSha: String(catalog.sha256), rules2: String(rules2.id), rules2Sha: String(rules2.sha256), rules3: String(rules3.id), override };
}
/** @typedef {Awaited<ReturnType<typeof t19Versions>>} T19 */

/**
 * A T19 cohort from the first day to `endsOn` (the third unless given): a setting from the first day
 * (T2's unit list and rules) and one from the third (RULES_3); each learner added on the first day,
 * its study stored (storeChain), then closed through the core. args: a recount of the first day with
 * RULES_2.
 * @param {pg.Pool} pool @param {T19} t @param {Array<[string, Study]>} learners @param {string} [endsOn]
 */
async function t19Cohort(pool, t, learners, endsOn = t.days[2]) {
    const [d1, , d3] = t.days;
    const cohort = await cohortWith(pool, { startsOn: d1, endsOn, catalogId: t.catalogId, ruleSetId: t.ruleSetId, from: d1, learners: learners.map(([user]) => user) });
    await pool.query("INSERT INTO training_cohort_time_settings (cohort_id, catalog_version_id, rule_set_id, effective_from, set_at, set_by, reason) VALUES ($1, $2, $3, $4::date, $5::timestamptz, 'verify', 'T19')",
        [cohort, t.catalogId, t.rules3, d3, iso(jstDayRange(d1).start)]);
    /** @type {Record<string, import('../../shared/training/studyTime.js').Signal[]>} */
    const signals = {};
    for (const [user, study] of learners) {
        signals[user] = [];
        for (const [i, unit, n] of study) signals[user].push(...await storeChain(pool, { user, cohort, unit, from: jstDayRange(t.days[i]).start + 10 * 3_600_000, n }));
        const closed = /** @type {any} */ (await close(pool, user, cohort));
        if (closed.status !== 'closed') throw new Error(`T19: a close answered ${closed.status ?? closed.error_type}`);
    }
    const slug = await slugOf(pool, cohort);
    return {
        cohort, slug, users: learners.map(([user]) => user).sort(), signals,
        args: { cohortSlug: slug, fromDay: d1, toDay: d1, rulesSha256: t.rules2Sha, recomputedBy: 'verify', reason: 'T19: other rules for the first day' },
    };
}
/** @typedef {Awaited<ReturnType<typeof t19Cohort>>} T19Cohort */
/** The check's answer of a T19 cohort, one line per learner. @param {pg.Pool} pool @param {T19Cohort} s */
const checkedT19 = async (pool, s) => checkedLines(await verifyCohort({ cohortSlug: s.slug, pool }));
/** Whether the check found every learner's three days matching. @param {string[]} lines @param {T19Cohort} s */
const nothingFound = (lines, s) => lines.join() === s.users.map((u) => `${u} 3`).join();
/** @param {string[]} lines @param {T19Cohort} s */
const findings = (lines, s) => (nothingFound(lines, s) ? 'finds nothing' : `finds ${lines.join(' | ')}`);

/** @param {pg.Pool} pool @param {{ catalogId: string, ruleSetId: string }} ids */
async function t19(pool, ids) {
    const t = await t19Versions(pool, ids);
    await t19Reads(pool, t);
    // The cohort of the write's statements, then of the baseline: B studies unit-b on the second day
    // only, A every day. B is made first, so its id comes first and A's unit rows are the write's
    // last statement.
    const [b, a] = [uid('t19b'), uid('t19a')];
    const p = await t19Cohort(pool, t, [[b, UNIT_B], [a, FULL]]);
    const planned = /** @type {any} */ (await planRecount({ ...p.args, pool }));
    await t19WriteLocks(pool, p, planned);
    await t19Baseline(pool, t, p, { a, b }, planned);
    await t19Close(pool, t);
    await t19Deletion(pool, t);
    await t19Twice(pool, t);
    await t19Migration(pool, t);
}

/**
 * T19, the dry run's reads (as T18 measures the check's): readRecountHead (both overrides found) and
 * readRecountLearner (a learner with a recount row: every read of readLearner), each in a snapshot
 * without its LOCK, and learnerHistory through the core without its opening statements (read by its
 * pid after its last read) lock exactly the tables their LOCK locks; the opening statements of each
 * (the LOCK, the 20 ms limit, the read of no rows) lock every index of them.
 * @param {pg.Pool} pool @param {T19} t
 */
async function t19Reads(pool, t) {
    const [d1] = t.days;
    const reader = uid('t19r');
    const s = await t19Cohort(pool, t, [[reader, FULL]]);
    // A recount row of the first day (its close copied, naming a record), so readLearner reads the
    // recounts too (only the reads are measured here; nothing checks these rows).
    await pool.query(`INSERT INTO training_time_days (user_id, cohort_id, day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, computed_by, recompute_id)
        SELECT user_id, cohort_id, day, 'recompute', algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals, evidence_sha256, 'verify', $3
          FROM training_time_days WHERE user_id = $1 AND day = $2::date AND kind = 'close'`, [reader, d1, await recountRecord(pool, s.cohort, d1, d1, t.ruleSetId)]);
    const lockOf = {
        head: await inSnapshot(pool, sending([RECOUNT_LOCKS.head[0]]), tablesLocked),
        learner: await inSnapshot(pool, sending([RECOUNT_LOCKS.learner[0]]), tablesLocked),
        history: await inSnapshot(pool, sending([RECOUNT_LOCKS.history[0]]), tablesLocked),
    };
    /** @type {any} */
    let head = null;
    const headReads = await inSnapshot(pool, async (c) => {
        head = await readRecountHead(c, s.slug, { rules: t.rules2Sha, catalog: t.catalogSha });
    }, tablesLocked);
    /** @type {any} */
    let read = null;
    const learnerReads = await inSnapshot(pool, async (c) => {
        read = await readRecountLearner(c, { userId: reader, cohort: { id: s.cohort, startsOn: d1 }, toDay: d1, rules: t.override });
    }, tablesLocked);
    /** @type {string[]} */
    let historyReads = [];
    const history = /** @type {any} */ (await learnerHistory({ userId: reader, cohortId: s.cohort, pool: changedConnections(pool, [{
        skip: [...RECOUNT_LOCKS.history], after: TRAINING_TIME_SQL.unitTotals, run: async (pid) => { historyReads = [...(await modesHeld(pool, pid)).keys()]; },
    }]) }));
    const found = head?.rules?.sha256 === t.rules2Sha && head?.catalog?.sha256 === t.catalogSha && head?.learners?.join() === reader;
    const records = read?.records;
    check('T19', found && sameTables(headReads, lockOf.head) && records?.rows.length === 4 && records.recounts.size === 1 && records.signals.length > 0
        && sameTables(learnerReads, lockOf.learner) && history?.rows?.length === 4 && sameTables(historyReads, lockOf.history),
        `the tables the dry run's reads lock without their LOCK: its first snapshot's (both overrides ${found ? 'found' : 'not found'}) ${same(headReads, lockOf.head)}; a learner's with a recount row (${records?.rows.length ?? 0} rows, ${records?.signals.length ?? 0} signals) ${same(learnerReads, lockOf.learner)}; a learner's history (${history?.rows?.length ?? history?.error_type} rows), read by its pid after its last read, ${same(historyReads, lockOf.history)}`);
    const indexes = {
        head: await inSnapshot(pool, sending(RECOUNT_LOCKS.head), indexesLocked(lockOf.head)),
        learner: await inSnapshot(pool, sending(RECOUNT_LOCKS.learner), indexesLocked(lockOf.learner)),
        history: await inSnapshot(pool, sending(RECOUNT_LOCKS.history), indexesLocked(lockOf.history)),
    };
    check('T19', every(indexes.head) && every(indexes.learner) && every(indexes.history),
        `the indexes of those tables their opening statements lock (the LOCK, the 20 ms limit, the read of no rows): the first snapshot's ${indexes.head}, a learner's ${indexes.learner}, a learner history's ${indexes.history}`);
}

/**
 * T19, the write's statements: the write through the core, with days to write, its three LOCKs and
 * its read of no rows not sent and its COMMIT sent as ROLLBACK (nothing kept); the tables its backend
 * holds after its last statement (A's unit rows; pg_locks by its pid) are exactly those its LOCKs
 * lock, none in a stronger mode than its LOCK's. Its read of no rows after the LOCKs locks every
 * index of those tables; control: the 20 ms limit and the LOCKs alone, none.
 * @param {pg.Pool} pool @param {T19Cohort} p @param {any} planned
 */
async function t19WriteLocks(pool, p, planned) {
    const recorded = recordingPool(pool);
    /** @type {Map<string, string>} */
    let held = new Map();
    let mark = -1;
    // What the write sends after the learners' locks: its LOCKs, then its read of no rows.
    const locks = RECOUNT_LOCKS.write.filter((sql) => sql.startsWith('LOCK TABLE '));
    const unkept = /** @type {any} */ (await recountCohort({ ...p.args, expect: planned.sha256, pool: changedConnections(recorded.pool, writeOnly(p.users.length, {
        skip: [...RECOUNT_LOCKS.write],
        send: new Map([['COMMIT', 'ROLLBACK']]),
        after: TRAINING_TIME_SQL.insertUnitDays,
        run: async (pid) => {
            held = await modesHeld(pool, pid);
            mark = recorded.sent.length;
        },
    })) }));
    const then = mark < 0 ? [] : recorded.sent.slice(mark);
    const kept = await recordsOf(pool, p.cohort);
    const alone = await inSnapshot(pool, sending(locks), (c) => modesHeld(c, null), 'BEGIN');
    const tables = [...alone.keys()];
    const stronger = [...held].filter(([table, mode]) => LOCK_MODES.indexOf(mode) > LOCK_MODES.indexOf(alone.get(table) ?? ''));
    const modes = [...LOCK_MODES].reverse().map((mode) => [mode, [...held.values()].filter((m) => m === mode).length]).filter(([, n]) => n).map(([mode, n]) => `${n} in ${mode}`).join(', ');
    check('T19', planned.status === 'plan' && planned.learners.length === 2 && unkept.error_type === 'unknown' && kept === 0 && then.join() === 'ROLLBACK'
        && tables.length > 0 && [...held.keys()].join() === tables.join() && stronger.length === 0,
        `the write without its LOCKs and its read of no rows, its COMMIT sent as ROLLBACK (it answered ${unkept.status ?? unkept.error_type}; ${kept} records kept), read by its pid after its last statement (then ${then.join() || 'nothing'}): it holds ${held.size} tables (${modes || 'none'}), ${sameTables([...held.keys()], tables) ? `the ${tables.length} its LOCKs lock` : `${[...held.keys()].join()} (its LOCKs: ${tables.join()})`}, ${stronger.length ? `in a stronger mode than its LOCK's: ${stronger.map(([x, m]) => `${x} ${m}`).join(', ')}` : 'none in a stronger mode than its LOCK\'s'}`);
    // In the write's order: its 20 ms limit, (the learners' advisory locks,) its LOCKs, its read of no rows.
    const opening = await inSnapshot(pool, sending([CHECK_SQL.tryLockTimeout, ...RECOUNT_LOCKS.write]), indexesLocked(tables), 'BEGIN');
    const lockAlone = await inSnapshot(pool, sending([CHECK_SQL.tryLockTimeout, ...locks]), indexesLocked(tables), 'BEGIN');
    check('T19', every(opening) && /^0 of [1-9]\d*$/.test(lockAlone),
        `the indexes of those tables the write's opening statements lock (the 20 ms limit, the LOCKs, the read of no rows): ${opening}; control, the 20 ms limit and the LOCKs alone: ${lockAlone}`);
}

/**
 * T19, the baseline through the core, on the cohort of the write's statements (nothing kept there):
 * the write with the dry run's sha256 answers it; it appends rows after the old ones (which stay as
 * they were), in day order, each naming the record; each learner's current rows are the pure
 * function's with each day's own versions (the override's on the recounted day) and the new carry,
 * and the check finds nothing; the record holds no learner value (its columns and values;
 * cohortRecounts and learnerHistory read it back); a dry run again changes nothing, a write with its
 * sha256 is unchanged and with the first one plan_changed; RECOUNT_SQL.fingerprint with the evidence
 * read's days and instants gives the read's day ids and count, +1 after a signal stored in its
 * window, in a stream already there.
 * @param {pg.Pool} pool @param {T19} t @param {T19Cohort} p @param {{ a: string, b: string }} who @param {any} planned
 */
async function t19Baseline(pool, t, p, { a, b }, planned) {
    const [d1, d2, d3] = t.days;
    /** @type {Record<string, any[]>} */
    const before = { [a]: await dayRows(pool, a, p.cohort), [b]: await dayRows(pool, b, p.cohort) };
    const written = /** @type {any} */ (await recountCohort({ ...p.args, expect: planned.sha256, pool }));
    /** A learner's rows after the write: the old ones, and the new ones after them. @param {string} user */
    const appended = async (user) => {
        const now = await dayRows(pool, user, p.cohort);
        const old = new Set(before[user].map((r) => String(r.id)));
        const kept = before[user].every((r) => JSON.stringify(now.find((x) => String(x.id) === String(r.id))) === JSON.stringify(r));
        const added = (await pool.query(`SELECT id, to_char(day, 'YYYY-MM-DD') AS day, kind, recompute_id, computed_by FROM training_time_days
            WHERE user_id = $1 AND cohort_id = $2 ORDER BY id`, [user, p.cohort])).rows.filter((r) => !old.has(String(r.id)));
        const newest = Math.max(...before[user].map((r) => Number(r.id)));
        const named = added.every((r) => r.kind === 'recompute' && String(r.recompute_id) === String(written.id) && r.computed_by === p.args.recomputedBy && Number(r.id) > newest);
        const days = added.map((r) => String(r.day));
        return { kept, ok: kept && named && days.every((day, i) => i === 0 || day > days[i - 1]), days };
    };
    const [rowsA, rowsB] = [await appended(a), await appended(b)];
    const shown = (/** @type {string[]} */ days) => days.map((d) => d.slice(5)).join(' ') || 'none';
    check('T19', written.status === 'recounted' && written.sha256 === planned.sha256 && written.learners === 2 && written.days === 4
        && rowsA.ok && rowsA.days.join() === [d1, d2, d3].join() && rowsB.ok && rowsB.days.join() === d1,
        `the write with the dry run's sha256: ${written.status ?? written.error_type} (${written.sha256 === planned.sha256 ? 'the same sha256' : 'another sha256'}), ${written.learners} learners, ${written.days} days; rows appended after the old ones, in day order, each naming the record: A ${shown(rowsA.days)}, B ${shown(rowsB.days)} (its versions only); the old rows ${rowsA.kept && rowsB.kept ? 'as they were' : 'changed'}`);

    const rulesOf = (/** @type {string} */ day) => (day <= d1 ? RULES_2 : day >= d3 ? RULES_3 : RULES);
    const ownRules = (/** @type {string} */ day) => (day <= d1 ? t.rules2 : day >= d3 ? t.rules3 : t.ruleSetId);
    /** Whether each current row of the learner is the pure function's day, with its versions. @param {string} user */
    const asPure = async (user) => {
        const want = countDays({ fromDay: d1, toDay: d3, signals: p.signals[user], rulesOf, setMsOf: () => setMsOf(unitsOf(2, 30)), carriedMs: new Map(), cohort: cohortRange(d1, d3) }).days;
        const current = [...new Map((await dayRows(pool, user, p.cohort)).map((r) => [r.day, r])).values()];
        let alike = current.length === 3 && want.length === 3;
        for (const [i, row] of current.entries()) {
            const units = (want[i]?.units ?? []).filter((u) => u.countedMs > 0 || u.overCapMs > 0)
                .map((u) => /** @type {[string, number, number]} */ ([u.unit, u.countedMs, u.overCapMs])).sort(byKey);
            alike &&= row.day === want[i]?.day && row.counted_ms === want[i].countedMs && row.over_cap_ms === want[i].units.reduce((n, u) => n + u.overCapMs, 0)
                && String(row.rule_set_id) === ownRules(row.day) && String(row.catalog_version_id) === t.catalogId
                && JSON.stringify(await unitRowsOf(pool, row.id)) === JSON.stringify(units);
        }
        return alike;
    };
    const [pureA, pureB] = [await asPure(a), await asPure(b)];
    const lines = await checkedT19(pool, p);
    check('T19', pureA && pureB && nothingFound(lines, p),
        `each learner's current rows as the pure function counts its signals, each day with its own versions (the override's on the recounted day) and the new carry: A ${pureA ? 'as' : 'unlike'} it, B ${pureB ? 'as' : 'unlike'} it; the check ${findings(lines, p)}`);

    const record = (await pool.query(`SELECT to_jsonb(r) AS j, r.cohort_id, to_char(r.from_day, 'YYYY-MM-DD') AS from_day, to_char(r.to_day, 'YYYY-MM-DD') AS to_day,
        r.rule_set_id, r.catalog_version_id, r.plan_sha256, r.recomputed_by, r.reason FROM training_time_recomputes r WHERE r.id = $1`, [written.id])).rows[0];
    const columns = Object.keys(record?.j ?? {}).sort().join(' ');
    const asInput = record?.cohort_id === p.cohort && record.from_day === d1 && record.to_day === d1 && String(record.rule_set_id) === t.rules2 && record.catalog_version_id === null
        && record.plan_sha256 === planned.sha256 && record.recomputed_by === p.args.recomputedBy && record.reason === p.args.reason;
    const text = JSON.stringify(record?.j ?? null).toLowerCase();
    const noAccount = [a, b].every((u) => !text.includes(u.toLowerCase()));
    const listed = /** @type {any} */ (await cohortRecounts({ cohortId: p.cohort, pool }));
    const history = /** @type {any} */ (await learnerHistory({ userId: a, cohortId: p.cohort, pool }));
    const recountRows = (history?.rows ?? []).filter((/** @type {any} */ r) => r.kind === 'recompute');
    const readBack = listed?.length === 1 && listed[0].id === String(written.id) && listed[0].planSha256 === planned.sha256 && listed[0].rulesSha256 === t.rules2Sha && listed[0].catalogSha256 === null;
    check('T19', columns === 'catalog_version_id cohort_id from_day id plan_sha256 reason recomputed_at recomputed_by rule_set_id to_day' && asInput && noAccount && readBack
        && history?.rows?.length === 6 && recountRows.length === 3 && recountRows.every((/** @type {any} */ r) => r.recomputeId === String(written.id)),
        `the record holds no learner value: its columns ${columns}; its values the recount's input and the plan's sha256 (${asInput}), no account id (${noAccount}); cohortRecounts reads it back (${readBack}); learnerHistory reads A's ${history?.rows?.length ?? history?.error_type} rows, the ${recountRows.length} recount rows naming it`);

    const again = /** @type {any} */ (await planRecount({ ...p.args, pool }));
    const rewrite = /** @type {any} */ (await recountCohort({ ...p.args, expect: again.sha256, pool }));
    const replay = /** @type {any} */ (await recountCohort({ ...p.args, expect: planned.sha256, pool }));
    const records = await recordsOf(pool, p.cohort);
    check('T19', again.status === 'plan' && again.learners?.length === 0 && again.sha256 !== planned.sha256 && rewrite.status === 'unchanged' && rewrite.sha256 === again.sha256
        && replay.status === 'plan_changed' && records === 1,
        `again: the dry run ${again.status ?? again.error_type} with ${again.learners?.length} learners to change (${again.sha256 !== planned.sha256 ? 'another sha256' : 'the same sha256'}); the write with its sha256 ${rewrite.status ?? rewrite.error_type}, with the first one ${replay.status ?? replay.error_type}; records ${records}`);

    /** @type {any} */
    let read = null;
    await inSnapshot(pool, async (c) => {
        read = await readRecountLearner(c, { userId: a, cohort: { id: p.cohort, startsOn: d1 }, toDay: d1, rules: t.override });
    }, async () => null);
    const evidence = read?.records?.evidence;
    const fingerprint = async () => (await pool.query(RECOUNT_SQL.fingerprint, [a, p.cohort, evidence?.first, evidence?.last, evidence?.from, evidence?.to])).rows[0];
    const first = await fingerprint();
    const ids = (read?.records?.rows ?? []).map((/** @type {any} */ r) => r.id);
    // One more signal of A's first chain, 7 s after its last, in that day's stream (no new stream).
    const chain = p.signals[a].filter((x) => x.chain === p.signals[a][0].chain);
    const last = chain[chain.length - 1];
    const streams = await streamsOf(pool, a, true);
    await pool.query(TRAINING_TIME_SQL.insertStream, [a, p.cohort, last.unit, last.chain, iso(last.born), iso(last.at + 7 * S)]);
    const stored = (await pool.query(TRAINING_TIME_SQL.insertSignal, [a, last.chain, iso(last.at + 7 * S), last.seq + 1, 6])).rowCount;
    const second = await fingerprint();
    const streamsNow = await streamsOf(pool, a, true);
    check('T19', Boolean(evidence) && ids.length === 6 && JSON.stringify(first?.day_ids) === JSON.stringify(ids) && Number(first?.evidence) === read.records.signals.length
        && stored === 1 && JSON.stringify(second?.day_ids) === JSON.stringify(ids) && Number(second?.evidence) === Number(first?.evidence) + 1 && streamsNow === streams,
        `RECOUNT_SQL.fingerprint with the evidence read's days and instants: its day ids ${JSON.stringify(first?.day_ids) === JSON.stringify(ids) ? `the read's (${ids.length} rows)` : 'not the read\'s'}, its count ${first?.evidence} (the read's ${read?.records?.signals?.length} signals); a signal stored in its window, in a stream already there (streams ${streams}, then ${streamsNow}): its count then ${second?.evidence}`);
}

/**
 * T19, a close in progress: a cohort closed up to its second day, then given a third (UPDATE ends_on,
 * as T3 does), on which A studies the unit whose time the recount of the first day carries otherwise.
 * The close of that day held HOLD_MS after its insert: the write started LEAD_MS later tries until
 * the close ends, then answers plan_changed and writes nothing; the check finds nothing. The same
 * when the close commits while the write's try is held after its account lock, before its learner
 * lock. Control: the write without its learner lock, the close held until the write ends: it does not
 * wait and recounts, and the check then finds that day's values (counted with the old carry).
 * @param {pg.Pool} pool @param {T19} t
 */
async function t19Close(pool, t) {
    const [, d2, d3] = t.days;
    const extended = async (/** @type {string} */ tag) => {
        const user = uid(tag);
        const s = await t19Cohort(pool, t, [[user, FULL]], d2);
        await pool.query('UPDATE training_cohorts SET ends_on = $2::date WHERE id = $1', [s.cohort, d3]);
        return { ...s, user, plan: /** @type {any} */ (await planRecount({ ...s.args, pool })) };
    };
    const w = await extended('t19c');
    const held = gate();
    const closing = close(changedConnections(pool, [{ holdAfter: TRAINING_TIME_SQL.insertDays, until: () => { held.open(); return sleep(HOLD_MS); } }]), w.user, w.cohort)
        .then((r) => /** @type {any} */ (r));
    const reached = await Promise.race([held.shut.then(() => true), closing.then(() => false)]);
    await sleep(LEAD_MS);
    const recorded = recordingPool(pool);
    const t0 = Date.now();
    const r = /** @type {any} */ (await recountCohort({ ...w.args, expect: w.plan.sha256, pool: recorded.pool }));
    const waited = Date.now() - t0;
    const closed = await closing;
    const tries = recorded.sent.filter((sql) => sql === 'BEGIN').length;
    const records = await recordsOf(pool, w.cohort);
    const lines = await checkedT19(pool, w);
    check('T19', w.plan.learners?.length === 1 && reached && closed.status === 'closed' && closed.fromDay === d3 && r.status === 'plan_changed' && waited >= BLOCKED_MS && tries >= 2
        && records === 0 && nothingFound(lines, w),
        `a close of a day added to the cohort, held ${HOLD_MS} ms after its insert (then ${closed.status ?? closed.error_type} from ${closed.fromDay?.slice(5)}): the write started ${LEAD_MS} ms later waited ${waited} ms (${tried(tries)}), then ${r.status ?? r.error_type}; records ${records}; the check ${findings(lines, w)}`);

    // The same close, committed while the write's try is held after its account lock (its first
    // SELECT), before its learner lock: what the try reads after the learner lock includes the
    // close's rows (each statement of a READ COMMITTED transaction reads what committed before it).
    const j = await extended('t19j');
    const heldJ = gate();
    const go = gate();
    const closingJ = close(changedConnections(pool, [{ holdAfter: TRAINING_TIME_SQL.insertDays, until: () => { heldJ.open(); return go.shut; } }]), j.user, j.cohort)
        .then((x) => /** @type {any} */ (x));
    const reachedJ = await Promise.race([heldJ.shut.then(() => true), closingJ.then(() => false)]);
    /** @type {any} */
    let between;
    try {
        between = await recountCohort({ ...j.args, expect: j.plan.sha256, pool: changedConnections(pool, writeOnly(1, {
            holdAfter: TRAINING_SQL.lock,
            until: async () => {
                go.open();
                await closingJ;
            },
        })) });
    } finally {
        go.open();
    }
    const closedJ = await closingJ;
    const recordsJ = await recordsOf(pool, j.cohort);
    const linesJ = await checkedT19(pool, j);
    check('T19', reachedJ && closedJ.status === 'closed' && closedJ.fromDay === d3 && between.status === 'plan_changed' && recordsJ === 0 && nothingFound(linesJ, j),
        `that close committed while the write's try was held after its account lock, before its learner lock: the write then ${between.status ?? between.error_type}; records ${recordsJ}; the check ${findings(linesJ, j)}`);

    const k = await extended('t19k');
    const heldK = gate();
    const ended = gate();
    const closingK = close(changedConnections(pool, [{ holdAfter: TRAINING_TIME_SQL.insertDays, until: () => { heldK.open(); return ended.shut; } }]), k.user, k.cohort)
        .then((x) => /** @type {any} */ (x));
    const reachedK = await Promise.race([heldK.shut.then(() => true), closingK.then(() => false)]);
    const t1 = Date.now();
    /** @type {any} */
    let free;
    try {
        free = await recountCohort({ ...k.args, expect: k.plan.sha256, pool: changedConnections(pool, writeOnly(1, { skip: [TRAINING_SQL.learnerLock] })) });
    } finally {
        ended.open();
    }
    const freeMs = Date.now() - t1;
    const closedK = await closingK;
    const linesK = await checkedT19(pool, k);
    check('T19', reachedK && free.status === 'recounted' && freeMs < BLOCKED_MS && closedK.status === 'closed' && linesK.join() === `${k.user} 3 ${d3}:values`,
        `control, the write without its learner lock: ${free.status ?? free.error_type} in ${freeMs} ms while the close was held after its insert (then ${closedK.status ?? closedK.error_type}); the check finds ${foundIn(linesK)}`);
}

/**
 * T19, an account deletion: the write held HOLD_MS after its last insert (the learner's unit rows);
 * the deletion service started LEAD_MS later waits for it, then marks the recount rows with the
 * tombstone's time; the record stays. Control: the write without the account lock while a deletion is
 * between its marks and its COMMIT: the recount rows of the deleted account stay live.
 * @param {pg.Pool} pool @param {T19} t
 */
async function t19Deletion(pool, t) {
    const user = uid('t19d');
    const s = await t19Cohort(pool, t, [[user, FULL]]);
    const plan = /** @type {any} */ (await planRecount({ ...s.args, pool }));
    const held = gate();
    const writing = recountCohort({ ...s.args, expect: plan.sha256, pool: changedConnections(pool, writeOnly(1, {
        holdAfter: TRAINING_TIME_SQL.insertUnitDays, until: () => { held.open(); return sleep(HOLD_MS); },
    })) }).then((r) => /** @type {any} */ (r));
    const reached = await Promise.race([held.shut.then(() => true), writing.then(() => false)]);
    await sleep(LEAD_MS);
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-verify-training-'));
    try {
        const t0 = Date.now();
        const deleted = await deleteAccountData({
            pool, userId: user, requestedBy: 'staff', authTime: null, billing: { config: null, stripe: null },
            logger: { log: () => {}, warn: () => {} }, uploadRoot, memory: { enabled: () => false, purge: async () => ({ ok: true }) }, invalidateCaches: () => {},
        });
        const waited = Date.now() - t0;
        const written = await writing;
        const rows = (await pool.query(`SELECT count(*) FILTER (WHERE d.kind = 'recompute' AND d.account_deleted_at = x.deleted_at)::int AS marked,
            count(*) FILTER (WHERE d.account_deleted_at IS NULL)::int AS live
            FROM training_time_days d JOIN account_deletions x USING (user_id) WHERE d.user_id = $1 AND d.cohort_id = $2`, [user, s.cohort])).rows[0];
        const kept = await recordsOf(pool, s.cohort);
        check('T19', reached && written.status === 'recounted' && deleted?.status === 'deleted' && waited >= BLOCKED_MS && rows?.marked === written.days && rows.live === 0 && kept === 1,
            `the write held ${HOLD_MS} ms after its last insert (then ${written.status ?? written.error_type}): the deletion service started ${LEAD_MS} ms later (${deleted?.status}) waited ${waited} ms, then marked the ${rows?.marked} recount rows with the tombstone's time (live rows ${rows?.live}); the record stays (${kept})`);
    } finally {
        await fs.rm(uploadRoot, { recursive: true, force: true }).catch(() => {});
    }

    const ctrl = uid('t19e');
    const c = await t19Cohort(pool, t, [[ctrl, FULL]]);
    const planC = /** @type {any} */ (await planRecount({ ...c.args, pool }));
    const deletion = await pool.connect();
    try {
        await deletionUpToStub(deletion, ctrl);
        const r = /** @type {any} */ (await recountCohort({ ...c.args, expect: planC.sha256, pool: changedConnections(pool, writeOnly(1, { skip: [TRAINING_SQL.lock] })) }));
        await deletion.query('COMMIT');
        const live = await count(pool, "SELECT count(*) AS n FROM training_time_days WHERE user_id = $1 AND kind = 'recompute' AND account_deleted_at IS NULL", [ctrl]);
        check('T19', r.status === 'recounted' && live > 0 && live === r.days,
            `control, the write without the account lock while a deletion is between its marks and its COMMIT: ${r.status ?? r.error_type}; live recount rows of the deleted account ${live}`);
    } catch (error) {
        await deletion.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        deletion.release();
    }
}

/**
 * T19, two writes with one sha256 at once (a staff member's double run): one recounted, one
 * plan_changed, one record; the check finds nothing.
 * @param {pg.Pool} pool @param {T19} t
 */
async function t19Twice(pool, t) {
    const s = await t19Cohort(pool, t, [[uid('t19x'), FULL], [uid('t19y'), FULL]]);
    const plan = /** @type {any} */ (await planRecount({ ...s.args, pool }));
    const both = await Promise.all([0, 1].map(() => recountCohort({ ...s.args, expect: plan.sha256, pool })));
    const statuses = both.map((r) => /** @type {any} */ (r).status ?? /** @type {any} */ (r).error_type).sort();
    const records = await recordsOf(pool, s.cohort);
    const lines = await checkedT19(pool, s);
    check('T19', plan.learners?.length === 2 && statuses.join() === 'plan_changed,recounted' && records === 1 && nothingFound(lines, s),
        `two writes with one sha256 at once: ${statuses.join(', ')}; records ${records}; the check ${findings(lines, s)}`);
}

/**
 * T19, a migration during the write: once the write's first try took its first learner's locks, a
 * migration alters the signals' table, HOLD_MS later the days' table, then rolls back. No backend
 * waits on a lock during the hold (sampled every 10 ms), its second statement goes through and the
 * write recounts after it (a try whose LOCK … NOWAIT found a table held rolled back, holding nothing,
 * and the next one started); the check finds nothing. Control: the write without its 20 ms limit, its
 * LOCKs and its read of no rows waits in its first read for the signals' table while it holds the
 * days': PostgreSQL cancels the migration as a deadlock (40P01).
 * @param {pg.Pool} pool @param {T19} t
 */
async function t19Migration(pool, t) {
    const addColumn = (/** @type {string} */ table) => `ALTER TABLE ${table} ADD COLUMN t19_probe integer`;
    const waitingCount = `SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND wait_event_type = 'Lock'`;
    /** @param {string} tag @param {ConnectionChange} change on the write's tries */
    const during = async (tag, change) => {
        const s = await t19Cohort(pool, t, [[uid(`${tag}a`), FULL], [uid(`${tag}b`), FULL]]);
        const plan = /** @type {any} */ (await planRecount({ ...s.args, pool }));
        const ddl = await pool.connect();
        const started = gate();
        /** @type {Promise<void> | null} */
        let first = null;
        let firstFailed = '';
        // Started once, after the first learner lock the write takes; the write goes on once the
        // statement has its lock, or after HOLD_MS (a write holding the signals' table goes on then).
        const migrate = () => {
            first ??= ddl.query('BEGIN').then(() => ddl.query(addColumn('training_time_signals'))).then(() => started.open(), (error) => {
                firstFailed = String(error.code ?? error);
                started.open();
            });
            return Promise.race([first, sleep(HOLD_MS)]);
        };
        const recorded = recordingPool(pool);
        try {
            const writing = recountCohort({ ...s.args, expect: plan.sha256, pool: changedConnections(recorded.pool, writeOnly(s.users.length, { ...change, after: TRAINING_SQL.learnerLock, run: migrate })) })
                .then((r) => /** @type {any} */ (r));
            const reached = await Promise.race([started.shut.then(() => true), writing.then(() => false)]);
            // During the hold, every 10 ms: how many other backends wait on a lock.
            /** @type {number[]} */
            const samples = [];
            for (const end = Date.now() + HOLD_MS; Date.now() < end; await sleep(10)) samples.push(await count(pool, waitingCount));
            const migrated = !reached ? 'not started' : firstFailed ? `its first statement ${firstFailed}`
                : await ddl.query(addColumn('training_time_days')).then(() => 'ok', (error) => String(error.code));
            await ddl.query('ROLLBACK');
            const r = await writing;
            await first;
            return {
                s, r, migrated, tries: recorded.sent.filter((sql) => sql === 'BEGIN').length, lines: await checkedT19(pool, s),
                waits: `${samples.filter((n) => n > 0).length} of ${samples.length}`,
            };
        } catch (error) {
            await ddl.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            ddl.release();
        }
    };
    const locked = await during('t19f', {});
    check('T19', locked.migrated === 'ok' && locked.r.status === 'recounted' && locked.tries >= 2 && /^0 of [1-9]\d*$/.test(locked.waits) && nothingFound(locked.lines, locked.s),
        `a migration altering the signals' table once the write's first try took its first learner's locks, then the days' table ${HOLD_MS} ms later: a backend waiting on a lock during the hold in ${locked.waits} samples; its second statement ${locked.migrated}; the write then ${locked.r.status ?? locked.r.error_type} (${tried(locked.tries)}); the check ${findings(locked.lines, locked.s)}`);
    const waiting = await during('t19w', { skip: [CHECK_SQL.tryLockTimeout, ...RECOUNT_LOCKS.write] });
    check('T19', waiting.migrated === '40P01' && !waiting.waits.startsWith('0 ') && waiting.r.status === 'recounted' && nothingFound(waiting.lines, waiting.s),
        `control, the write without its 20 ms limit, its LOCKs and its read of no rows: it waits on a lock during the hold (${waiting.waits} samples); the migration's second statement ${waiting.migrated === '40P01' ? 'is cancelled as a deadlock (40P01)' : waiting.migrated}; the write then ${waiting.r.status ?? waiting.r.error_type} (${tried(waiting.tries)}); the check ${findings(waiting.lines, waiting.s)}`);
}

/**
 * 'reads both days, matching' for a one-learner answer with two days and no difference, 'reads no
 * learner' for an answer without one. @param {string[]} lines @param {string} user
 */
const matchesTwo = (lines, user) => (lines.join() === `${user} 2` ? 'reads both days, matching' : lines.length === 0 ? 'reads no learner' : lines.join());

/**
 * A pool for the core that records the statements its connections send (after changedConnections'
 * changes, when it wraps this one). Its connections keep their backend's pid (processID).
 * @param {pg.Pool} pool @returns {{ pool: any, sent: string[] }}
 */
function recordingPool(pool) {
    /** @type {string[]} */
    const sent = [];
    return {
        sent,
        pool: {
            query: (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
                sent.push(sql);
                return pool.query(sql, params);
            },
            connect: async () => {
                const client = await pool.connect();
                return {
                    processID: client.processID,
                    query: (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
                        sent.push(sql);
                        return client.query(sql, params);
                    },
                    release: (/** @type {any} */ error) => client.release(error),
                };
            },
        },
    };
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
        await waitPastJstMidnight({ query: (sql) => pool.query(sql), budgetS: 90 });
        const files = (await fs.readdir(MIGRATIONS)).filter((name) => /^\d+_.+\.sql$/i.test(name)).sort((a, b) => a.localeCompare(b));
        for (const run of [1, 2]) {
            for (const file of files) await applyMigration(pool, file);
            check('M', files.includes(FILE) && files.includes(FILE_023), `run ${run}: applied ${files.length} migrations (${files[0]} … ${files.at(-1)}), each in its own transaction`);
        }
        const ids = await t2(pool);
        await t1(pool, ids);
        await t3(pool, ids);
        await t4(pool, ids);
        await t5t6(pool, ids);
        await t7(pool);
        await t8(pool);
        await t9(pool, ids);
        await t10(pool, ids);
        await t11(pool, ids);
        await t12(pool, ids);
        await t13(pool, ids);
        await t14(pool, ids);
        await t15(pool, ids);
        await t16(pool, ids);
        await t17(pool, ids);
        await t18(pool, ids);
        await t19(pool, ids);
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
