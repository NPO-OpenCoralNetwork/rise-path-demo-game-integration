// Job training, recounts of closed study time days (tools/core/trainingTimeRecount.js;
// doc/brushup-2026/training-plan.ja.md §4.9, D12), on the in-memory tables of
// server/tests/helpers/trainingTimePool.js. Pinned here:
// - the recount: other versions for from..to, every later closed day with its own row's versions and
//   the new carry, only the days whose versions or values (each unit's too) change; a later recount
//   never undoes an earlier one; an override with a wider evidence window writes its own window's
//   evidence; both overrides at once;
// - the plan: plain data, units as [key, counted, over] in code-unit order, named by the sha256 of its
//   canonical JSON, which binds who and why;
// - the refusals, in their order: the input before any statement; the cohort, its dates, the
//   overrides (not loaded; not countable: the rule countWith applies), the settings, --to not final
//   under the wider of the override's gapMs and its setting's (the day only); once every learner was
//   read, rows that do not check, then days not closed, then another course (the day only), whatever
//   the learners' order;
// - the dry run: a first snapshot, then one per learner, each with its tables locked first (exactly
//   the tables its reads use), no advisory lock, nothing written; a busy lock tried again, any other
//   error not;
// - the write: the dry run again, the sha256 compared before any lock, then one READ COMMITTED
//   transaction: the 20 ms lock timeout, each counted learner's two locks in id order, the tables
//   (written, referenced by the written ones' foreign keys, read: exactly the statements' tables) and
//   their indexes, each learner's rows and evidence count compared with the dry run's (plan_changed
//   when another session's close, signal, deletion or recount committed since), the record (no learner
//   value), the rows in day order and their units; a busy lock anywhere tries again, any other error
//   not; a stub gone is a fault;
// - the clock guard widened by a recount's gapMs, never narrowed, a marked row not read;
// - the staff reads (a cohort's recounts; a learner's rows and units in one snapshot, no row's time).
// The same on PostgreSQL 16 (locks, waits, the deletion, migrations) is proved by
// scripts/db/verify-training.mjs (T19, T15). Every rule value here is artificial.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { cohortRange, evidenceWindow, jstDayRange } from '../../shared/training/studyTime.js';
import { parseTimeRules } from '../../shared/training/timeRules.js';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { TRAINING_TIME_SQL, closeDays, evidenceDigest, learnerDays, loadCatalog, loadRules, recordSignal, signalOf } from '../../tools/core/trainingTime.js';
import { CHECK_SQL, LOCK_RETRY, currentRows, readLearner, rulesVersionOf, verifyCohort } from '../../tools/core/trainingTimeCheck.js';
import {
    RECOUNT_LOCKS,
    RECOUNT_PLAN,
    RECOUNT_SQL,
    cohortRecounts,
    learnerHistory,
    planRecount,
    recountCohort,
    recountLearner,
} from '../../tools/core/trainingTimeRecount.js';
import { bare, lockedBy, reads, referencedBy } from './helpers/sqlTables.js';
import { createTrainingTimePool } from './helpers/trainingTimePool.js';

const S = 1000;
const A = 'aaaaaaaa-2222-4000-8000-0000000000a1';
const B = 'aaaaaaaa-2222-4000-8000-0000000000b2';
const C = 'aaaaaaaa-2222-4000-8000-0000000000c3';
const COHORT = 'c2200000-0000-4000-8000-000000000001';
const SLUG = 'web-2026-11';
// Artificial rules: a pair counts up to 13 s (R1) or 5 s (R2). FAR reads its evidence from further
// back and ahead (gapMs 29 s and idleMs 151 s, R1's 23 s and 101 s); NARROW's gap is 11 s, WIDE's 6
// hours (each counts a pair 7 s apart as R1 does).
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7 * S, minSpacingMs: 3 * S, maxPlaces: 3 },
    counting: { gapMs: 23 * S, creditCapMs: 13 * S, idleMs: 101 * S, requireFocus: false, overlap: 'prefer_focus_latest' },
});
const RULES_IN_2 = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 5 * S } });
const RULES_FAR = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 29 * S, idleMs: 151 * S } });
const RULES_NARROW = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 11 * S, creditCapMs: 11 * S } });
const RULES_WIDE = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 6 * 60 * 60 * S } });
const FAR = /** @type {any} */ (parseTimeRules(RULES_FAR)).rules;
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));
// The same course with sample-u1 at 3 minutes instead of 2; another course.
const COURSE_3 = { ...COURSE, units: [{ ...COURSE.units[0], setMinutes: 3 }, COURSE.units[1]] };
const OTHER_COURSE = { ...COURSE, courseKey: 'other-course' };
const U1 = 'sample-u1'; // 2 minutes
const U2 = 'sample-u2'; // 30 minutes
const sha256 = (/** @type {string} */ text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const at = (/** @type {string} */ iso) => Date.parse(iso);
const chainId = (/** @type {number} */ n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03'];
const busy = () => Object.assign(new Error('could not obtain lock'), { code: '55P03' });
const missing = () => Object.assign(new Error('relation does not exist'), { code: '42P01' });

/**
 * A cohort of November 2026 (12:00 JST on 11-04) with the given learners added on 10-31 JST, the unit
 * list K1 and the rules R1 in effect from 11-01, the other rules loaded, and for each of `study` 11
 * signals 7 s apart on sample-u1 at 10:00 JST of each day of DAYS (70 s a day: 70, 50 + 20 over, 0 +
 * 70 over). No day is closed yet.
 * @param {{ clock?: number, learners?: string[], study?: string[] }} [options]
 */
async function seeded({ clock = at('2026-11-04T03:00:00Z'), learners = [A], study = learners } = {}) {
    const pool = createTrainingTimePool({
        clock,
        stubs: [A, B, C],
        cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
        memberships: learners.map((user) => ({ user_id: user, cohort_id: COHORT, added_at: at('2026-10-31T01:00:00Z') })),
    });
    const load = async (/** @type {unknown} */ input) => /** @type {any} */ (await loadRules({ input, loadedBy: 'staff-a', note: 'sample', pool }));
    const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'staff-a', note: 'sample', pool }));
    const r1 = await load(RULES_IN);
    const r2 = await load(RULES_IN_2);
    const far = await load(RULES_FAR);
    const narrow = await load(RULES_NARROW);
    const wide = await load(RULES_WIDE);
    pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: r1.id, effectiveFrom: '2026-11-01' });
    let n = 0;
    for (const user of study) {
        for (const day of DAYS) {
            n += 1;
            chain(pool, user, n, at(`${day}T01:00:00Z`), 11);
        }
    }
    return { pool, catalog, r1, r2, far, narrow, wide };
}

/** A chain's signals stored for a learner: `count` of them 7 s apart from `from`, with focus and input. */
function chain(/** @type {any} */ pool, /** @type {string} */ user, /** @type {number} */ n, /** @type {number} */ from, /** @type {number} */ count, unit = U1) {
    for (let seq = 0; seq < count; seq += 1) pool.addSignal({ userId: user, cohortId: COHORT, unit, chain: chainId(n), born: from, seq, at: from + seq * 7 * S, focus: true, input: true });
}

const close = (/** @type {any} */ pool, userId = A) => closeDays({ userId, cohortId: COHORT, computedBy: 'staff', pool });
const values = async (/** @type {any} */ pool, userId = A) => (/** @type {any} */ (await learnerDays({ userId, cohortId: COHORT, pool }))).days.map((/** @type {any} */ d) => [d.day, d.kind, d.countedMs / S, d.overCapMs / S]);
const recount = (/** @type {any} */ pool, over = {}) => ({ cohortSlug: SLUG, fromDay: '2026-11-01', toDay: '2026-11-01', recomputedBy: 'staff-a', reason: 'the provider confirmed new rules', pool, ...over });
const changedOf = (/** @type {any} */ plan) => plan.learners.map((/** @type {any} */ l) => [l.userId, l.days.map((/** @type {any} */ d) => [d.day, d.before.countedMs / S, d.before.overCapMs / S, d.after.countedMs / S, d.after.overCapMs / S])]);
const dry = async (/** @type {any} */ pool, over = {}) => /** @type {any} */ (await planRecount(recount(pool, over)));
const write = async (/** @type {any} */ pool, over = {}) => /** @type {any} */ (await recountCohort(recount(pool, over)));
/** A learner's current row of a day (read each time: the pool's state is another object after a rollback). */
const rowOf = (/** @type {any} */ pool, /** @type {string} */ day, user = A) => pool.state.days.filter((/** @type {any} */ d) => d.user_id === user && d.day === day && d.account_deleted_at === null).at(-1);

/** Each try's statements, from its BEGIN to its ROLLBACK or COMMIT. @param {Array<{ sql: string }>} sent */
function triesOf(sent) {
    /** @type {string[][]} */
    const tries = [];
    /** @type {string[] | null} */
    let open = null;
    for (const { sql } of sent) {
        if (sql === TRAINING_TIME_SQL.beginSnapshot || sql === 'BEGIN') {
            open = [sql];
            tries.push(open);
            continue;
        }
        open?.push(sql);
        if (sql === 'ROLLBACK' || sql === 'COMMIT') open = null;
    }
    return tries;
}

/** A sleep that only records, and a clock that it moves. */
function fakeTime() {
    let clock = 0;
    /** @type {number[]} */
    const slept = [];
    return { slept, now: () => clock, sleep: async (/** @type {number} */ ms) => { slept.push(ms); clock += ms; } };
}

const SNAPSHOT = TRAINING_TIME_SQL.beginSnapshot;
const LEARNER_TRY = [SNAPSHOT, TRAINING_SQL.lockTimeout, ...RECOUNT_LOCKS.learner, RECOUNT_SQL.learnerMember, TRAINING_TIME_SQL.closeSettings, CHECK_SQL.learnerRows, CHECK_SQL.unitRows,
    CHECK_SQL.rulesByIds, CHECK_SQL.catalogsByIds, TRAINING_TIME_SQL.evidence, 'ROLLBACK'];

describe('tools/core/trainingTimeRecount.js: the plan', () => {
    it('the dry run: a first snapshot (the cohort and its learners, the override, the settings, the clock), then one per learner in id order (its membership, the settings, its rows, units, versions and evidence), each with its tables locked first; every statement on its client; no advisory lock, nothing written', async () => {
        const { pool, r2 } = await seeded({ learners: [B, A] });
        await close(pool, A);
        await close(pool, B);
        const days = structuredClone(pool.state.days);
        const sent0 = pool.queries.length;
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        assert.equal(plan.status, 'plan');
        const sent = pool.queries.slice(sent0);
        assert.ok(sent.every((q) => q.tx), 'every statement in a transaction, on its client');
        const tries = triesOf(sent);
        assert.equal(tries.flat().length, sent.length, 'nothing between the snapshots');
        assert.deepEqual(tries, [
            [SNAPSHOT, TRAINING_SQL.lockTimeout, ...RECOUNT_LOCKS.head, TRAINING_SQL.cohortBySlug, TRAINING_TIME_SQL.learners, RECOUNT_SQL.rulesBySha, TRAINING_TIME_SQL.closeSettings, RECOUNT_SQL.clock, 'ROLLBACK'],
            LEARNER_TRY,
            LEARNER_TRY,
        ]);
        assert.deepEqual(sent.filter((q) => q.sql === RECOUNT_SQL.learnerMember).map((q) => q.params), [[A, COHORT], [B, COHORT]], 'learners in id order');
        assert.ok(!sent.some((q) => [TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared, TRAINING_TIME_SQL.closeState, 'BEGIN', 'COMMIT'].includes(q.sql)),
            'no advisory lock, no closeState (its tables are not the snapshot\'s), no write transaction');
        assert.deepEqual(pool.state.days, days, 'nothing written');
        assert.deepEqual(pool.state.recounts, []);
        // Both overrides: each read by its sha256 in the first snapshot.
        const k3 = /** @type {any} */ (await loadCatalog({ input: COURSE_3, loadedBy: 'staff-a', note: 'u1 three minutes', pool }));
        const sent1 = pool.queries.length;
        assert.equal((await dry(pool, { rulesSha256: r2.sha256, catalogSha256: k3.sha256 })).status, 'plan');
        assert.deepEqual(triesOf(pool.queries.slice(sent1))[0].slice(-5, -1), [RECOUNT_SQL.rulesBySha, RECOUNT_SQL.catalogBySha, TRAINING_TIME_SQL.closeSettings, RECOUNT_SQL.clock]);
        assert.deepEqual(pool.queries.slice(sent1).filter((q) => q.sql === RECOUNT_SQL.catalogBySha).map((q) => q.params), [[k3.sha256]]);
    });

    it('the override for from..to, every later closed day with its own versions and the new carry, only the changed days; plain data named by the sha256 of its canonical JSON, which binds who and why (as trimmed)', async () => {
        const { pool, r1, r2, catalog } = await seeded();
        await close(pool);
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        // 11-01 with R2: 10 pairs of 5 s; 11-02 with R1 and 50 s carried: 70 s fit under the set time; 11-03 unchanged.
        assert.deepEqual(changedOf(plan), [[A, [['2026-11-01', 70, 0, 50, 0], ['2026-11-02', 50, 20, 70, 0]]]]);
        const row1 = rowOf(pool, '2026-11-01');
        const row2 = rowOf(pool, '2026-11-02');
        assert.deepEqual(plan.plan, {
            plan: RECOUNT_PLAN, cohort: COHORT, from: '2026-11-01', to: '2026-11-01', rules: r2.sha256, catalog: null, by: 'staff-a', reason: 'the provider confirmed new rules',
            learners: [{
                user: A,
                days: [
                    {
                        day: '2026-11-01',
                        before: { row: row1.id, rules: r1.sha256, catalog: catalog.sha256, countedMs: 70 * S, overCapMs: 0, units: [[U1, 70 * S, 0]] },
                        after: { algorithm: 'study-time/v1', rules: r2.sha256, catalog: catalog.sha256, countedMs: 50 * S, overCapMs: 0, signals: 11, evidence: row1.evidence_sha256, units: [[U1, 50 * S, 0]] },
                    },
                    {
                        day: '2026-11-02',
                        before: { row: row2.id, rules: r1.sha256, catalog: catalog.sha256, countedMs: 50 * S, overCapMs: 20 * S, units: [[U1, 50 * S, 20 * S]] },
                        after: { algorithm: 'study-time/v1', rules: r1.sha256, catalog: catalog.sha256, countedMs: 70 * S, overCapMs: 0, signals: 11, evidence: row2.evidence_sha256, units: [[U1, 70 * S, 0]] },
                    },
                ],
            }],
        });
        assert.equal(plan.sha256, sha256(canonicalJson(plan.plan)));
        assert.equal(JSON.stringify(plan.plan), JSON.stringify(JSON.parse(JSON.stringify(plan.plan))), 'plain data only: no Map, Date or BigInt');
        assert.deepEqual(Object.keys(plan).sort(), ['learners', 'plan', 'sha256', 'status'], 'what each learner read stays inside the module');
        // The same input again: the same plan. Who or why changed: another sha256 (it binds them); the same once trimmed: the same.
        assert.equal((await dry(pool, { rulesSha256: r2.sha256 })).sha256, plan.sha256);
        assert.equal((await dry(pool, { rulesSha256: r2.sha256, recomputedBy: '  staff-a ', reason: ' the provider confirmed new rules\n' })).sha256, plan.sha256);
        assert.notEqual((await dry(pool, { rulesSha256: r2.sha256, recomputedBy: 'staff-b' })).sha256, plan.sha256);
        assert.notEqual((await dry(pool, { rulesSha256: r2.sha256, reason: 'another' })).sha256, plan.sha256);
    });

    it('both overrides at once: the rules and the unit list inside from..to, each later day with its own; a day whose versions alone change is a change', async () => {
        const { pool, r1, r2, catalog } = await seeded();
        await close(pool);
        const k3 = /** @type {any} */ (await loadCatalog({ input: COURSE_3, loadedBy: 'staff-a', note: 'u1 three minutes', pool }));
        // 11-01 and 11-02 with R2 and the 3-minute list: 50 s each, under 3 minutes; 11-03 with its own
        // R1 and K1 (2 minutes) and 100 s carried: 20 s, 50 s over.
        const plan = await dry(pool, { toDay: '2026-11-02', rulesSha256: r2.sha256, catalogSha256: k3.sha256 });
        assert.deepEqual(changedOf(plan), [[A, [['2026-11-01', 70, 0, 50, 0], ['2026-11-02', 50, 20, 50, 0], ['2026-11-03', 0, 70, 20, 50]]]]);
        assert.deepEqual(plan.learners[0].days.map((/** @type {any} */ d) => [d.after.rules, d.after.catalog]), [[r2.sha256, k3.sha256], [r2.sha256, k3.sha256], [r1.sha256, catalog.sha256]]);
        assert.deepEqual([plan.plan.rules, plan.plan.catalog], [r2.sha256, k3.sha256]);
        // The 3-minute list alone on 11-01: the same numbers (70 s under either set time), another version.
        const versions = await dry(pool, { catalogSha256: k3.sha256 });
        assert.deepEqual(changedOf(versions), [[A, [['2026-11-01', 70, 0, 70, 0]]]]);
        assert.deepEqual([versions.plan.rules, versions.learners[0].days[0].after.catalog, versions.learners[0].days[0].after.rules], [null, k3.sha256, r1.sha256]);
        const written = await write(pool, { catalogSha256: k3.sha256, expect: versions.sha256 });
        assert.deepEqual([written.status, written.days], ['recounted', 1]);
        assert.deepEqual(pool.state.recounts.map((/** @type {any} */ r) => [r.rule_set_id, r.catalog_version_id]), [[null, k3.id]]);
        assert.deepEqual((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }))).learners[0].differences, []);
    });

    it('a later recount never undoes an earlier one: a day\'s own versions are its current row\'s, inside the range for the version not overridden and on every later day', async () => {
        const { pool, r2 } = await seeded();
        await close(pool);
        const k3 = /** @type {any} */ (await loadCatalog({ input: COURSE_3, loadedBy: 'staff-a', note: 'u1 three minutes', pool }));
        // #1: R2 on 11-02 only (11-02: 50 s carried, R2 gives 50 s under the set time).
        const p1 = await dry(pool, { fromDay: '2026-11-02', toDay: '2026-11-02', rulesSha256: r2.sha256 });
        assert.deepEqual(changedOf(p1), [[A, [['2026-11-02', 50, 20, 50, 0]]]]);
        assert.equal((await write(pool, { fromDay: '2026-11-02', toDay: '2026-11-02', rulesSha256: r2.sha256, expect: p1.sha256 })).status, 'recounted');
        // #2: the 3-minute unit list on 11-01 only. 11-01 keeps its numbers (a version change only);
        // 11-02 is counted with its own R2 (not the setting's R1) and the 2-minute list of its row.
        const p2 = await dry(pool, { catalogSha256: k3.sha256 });
        assert.deepEqual(changedOf(p2), [[A, [['2026-11-01', 70, 0, 70, 0]]]]);
        assert.deepEqual(p2.learners[0].days[0].after.catalog, k3.sha256);
        assert.equal((await write(pool, { catalogSha256: k3.sha256, expect: p2.sha256 })).status, 'recounted');
        assert.deepEqual(await values(pool), [['2026-11-01', 'recompute', 70, 0], ['2026-11-02', 'recompute', 50, 0], ['2026-11-03', 'close', 0, 70]]);
        assert.deepEqual((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }))).learners[0].differences, []);
    });

    it('an override that reads its evidence from further back and ahead writes the count and the sha256 of its own window (the evidence read covers it)', async () => {
        const { pool, far, catalog } = await seeded();
        // Signals of their own chains that only FAR reads for 11-01: 00:00:26 JST of 11-02 (FAR's gapMs
        // 29 s after its end, not R1's 23 s) and 23:58:00 JST before 11-01 (FAR's look-back 151 s, not R1's 101 s).
        chain(pool, A, 97, at('2026-11-01T15:00:26Z'), 1);
        chain(pool, A, 98, at('2026-10-31T14:58:00Z'), 1);
        await close(pool);
        const signals = pool.state.signals.map((/** @type {any} */ g) => {
            const s = pool.state.streams.find((/** @type {any} */ x) => x.id === g.stream_id);
            return signalOf({ chain_id: s.chain_id, unit_key: s.unit_key, born: s.chain_started_at, seq: g.seq, at: g.received_at, flags: g.flags });
        });
        const w = evidenceWindow(jstDayRange('2026-11-01').start, jstDayRange('2026-11-01').end, FAR.counting);
        const evidence = signals.filter((s) => s.at >= w.from && s.at <= w.to);
        assert.equal(evidence.length, rowOf(pool, '2026-11-01').signals + 2, 'FAR reads two more signals for 11-01 than R1 did');
        const plan = await dry(pool, { rulesSha256: far.sha256 });
        assert.deepEqual(plan.learners[0].days.map((/** @type {any} */ d) => [d.day, d.after.countedMs / S, d.after.signals, d.after.evidenceSha256]), [['2026-11-01', 70, evidence.length, evidenceDigest(evidence)]]);
        assert.equal((await write(pool, { rulesSha256: far.sha256, expect: plan.sha256 })).status, 'recounted');
        assert.deepEqual([rowOf(pool, '2026-11-01').signals, rowOf(pool, '2026-11-01').catalog_version_id], [evidence.length, catalog.id]);
        assert.deepEqual((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }))).learners[0].differences, [], 'the check reads the same window');
    });

    it('one learner\'s changed days (pure): the units compared one by one (a split with the same totals is a change), in code-unit order; null when a day cannot be counted with its versions', async () => {
        const { pool } = await seeded();
        await close(pool);
        const records = await readLearner(pool, A, COHORT);
        const range = cohortRange('2026-11-01', '2026-11-30');
        // 11-01 stored with its 70 s split over two units: the totals match, the units do not.
        currentRows(records.rows)[0].units = [[U1, 60 * S, 0], [U2, 10 * S, 0]];
        const days = /** @type {any[]} */ (recountLearner({ records, fromDay: '2026-11-01', toDay: '2026-11-01', rules: null, catalog: null, cohort: range }));
        assert.deepEqual(days.map((d) => [d.day, d.before.units, d.after.units]), [['2026-11-01', [[U1, 60 * S, 0], [U2, 10 * S, 0]], [[U1, 70 * S, 0]]]]);
        // Rules of a version this code does not have: no day is counted with another.
        const v2 = rulesVersionOf({ id: '900', sha256: 'c'.repeat(64), algorithm: 'study-time/v2', params: { ...structuredClone(RULES_IN), algorithm: 'study-time/v2' } });
        assert.equal(recountLearner({ records, fromDay: '2026-11-01', toDay: '2026-11-01', rules: v2, catalog: null, cohort: range }), null);
        // Units whose keys the database's collation orders otherwise (en_US.utf8: unit1 before unit-b):
        // in code-unit order on both sides, so a day that does not change is not a change.
        const keys = { ...COURSE, units: [...COURSE.units, { key: 'unit-b', title: { jp: 'B', en: 'B' }, setMinutes: 30 }, { key: 'unit1', title: { jp: '1', en: '1' }, setMinutes: 30 }] };
        const { pool: other, r1, r2 } = await seeded();
        const k4 = /** @type {any} */ (await loadCatalog({ input: keys, loadedBy: 'staff-a', note: 'sample', pool: other }));
        other.addSetting({ cohortId: COHORT, catalogId: k4.id, ruleSetId: r1.id, effectiveFrom: '2026-11-03' });
        chain(other, A, 95, at('2026-11-03T03:00:00Z'), 11, 'unit-b');
        chain(other, A, 96, at('2026-11-03T05:00:00Z'), 6, 'unit1');
        await close(other);
        const day3 = rowOf(other, '2026-11-03');
        assert.deepEqual((await other.query(CHECK_SQL.unitRows, [[day3.id]])).rows.map((/** @type {any} */ u) => u.unit_key), [U1, 'unit1', 'unit-b'], 'the rows come in the collation\'s order');
        const plan = await dry(other, { rulesSha256: r2.sha256 });
        assert.deepEqual(changedOf(plan), [[A, [['2026-11-01', 70, 0, 50, 0], ['2026-11-02', 50, 20, 70, 0]]]], '11-03 (three units, the same carry) does not change');
        const sorted = await dry(other, { fromDay: '2026-11-03', toDay: '2026-11-03', rulesSha256: r2.sha256 });
        assert.deepEqual(sorted.learners[0].days[0].before.units.map((/** @type {any} */ u) => u[0]), [U1, 'unit-b', 'unit1'], 'before: code-unit order');
        assert.deepEqual(sorted.learners[0].days[0].after.units.map((/** @type {any} */ u) => u[0]), [U1, 'unit-b', 'unit1'], 'after: code-unit order');
    });
});

describe('tools/core/trainingTimeRecount.js: refusals', () => {
    it('the input is checked before any statement: at least one override, sha256 names (64 lower-case hex digits), the days, who (1 to 100 characters) and why (1 to 500), the plan\'s sha256', async () => {
        const { pool, r2 } = await seeded();
        await close(pool);
        const sent = pool.queries.length;
        const emoji = '\u{1F600}'; // one character, two UTF-16 units
        for (const over of [
            {}, { rulesSha256: r2.sha256.toUpperCase() }, { catalogSha256: 'g'.repeat(64) }, { rulesSha256: '' }, { rulesSha256: r2.sha256.slice(1) },
            { rulesSha256: r2.sha256, fromDay: '2026-11-02', toDay: '2026-11-01' }, { rulesSha256: r2.sha256, toDay: '2026-02-30' }, { rulesSha256: r2.sha256, fromDay: '2026-11-1' },
            { rulesSha256: r2.sha256, fromDay: '2026-02-30' }, { rulesSha256: r2.sha256, fromDay: '2026-11-31', toDay: '2026-11-31' }, { rulesSha256: r2.sha256, fromDay: '0000-11-01' },
            { rulesSha256: r2.sha256, fromDay: undefined }, { rulesSha256: r2.sha256, recomputedBy: ' ' }, { rulesSha256: r2.sha256, recomputedBy: emoji.repeat(101) },
            { rulesSha256: r2.sha256, reason: emoji.repeat(501) }, { rulesSha256: r2.sha256, reason: '' },
        ]) {
            assert.equal((await dry(pool, over)).error_type, 'validation', JSON.stringify(over));
            assert.equal((await write(pool, { ...over, expect: 'a'.repeat(64) })).error_type, 'validation', JSON.stringify(over));
        }
        for (const expect of ['nope', 'A'.repeat(64), 'a'.repeat(63), undefined]) assert.equal((await write(pool, { rulesSha256: r2.sha256, expect })).error_type, 'validation', String(expect));
        assert.equal(pool.queries.length, sent, 'no statement');
        // 100 and 500 characters (each two UTF-16 units) are written as given.
        const plan = await dry(pool, { rulesSha256: r2.sha256, recomputedBy: emoji.repeat(100), reason: emoji.repeat(500) });
        assert.equal((await write(pool, { rulesSha256: r2.sha256, recomputedBy: emoji.repeat(100), reason: emoji.repeat(500), expect: plan.sha256 })).status, 'recounted');
        assert.deepEqual(pool.state.recounts.map((/** @type {any} */ r) => [Array.from(r.recomputed_by).length, Array.from(r.reason).length]), [[100, 500]]);
    });

    it('before the learners are read: no cohort, no dates, days outside them, an override not loaded, one this code cannot count with (which and why, as countWith judges it), a stored setting that does not parse, --to not final under the wider of the override\'s gapMs and its setting\'s (the day only)', async () => {
        const { pool, r2, narrow, wide } = await seeded();
        await close(pool);
        const k3 = /** @type {any} */ (await loadCatalog({ input: COURSE_3, loadedBy: 'staff-a', note: 'u1 three minutes', pool }));
        const refusal = async (/** @type {object} */ over, /** @type {unknown} */ expected) => {
            const sent = pool.queries.length;
            assert.deepEqual(await dry(pool, over), expected, JSON.stringify(over));
            assert.ok(!pool.queries.slice(sent).some((q) => q.sql === RECOUNT_SQL.learnerMember), 'no learner read');
            assert.deepEqual(await write(pool, { ...over, expect: 'a'.repeat(64) }), expected);
        };
        await refusal({ cohortSlug: 'no-such', rulesSha256: r2.sha256 }, { status: 'no_cohort' });
        pool.state.cohorts.push({ id: 'c2200000-0000-4000-8000-000000000009', slug: 'no-dates', name: 'X', starts_on: '2026-11-01', ends_on: null });
        await refusal({ cohortSlug: 'no-dates', rulesSha256: r2.sha256 }, { status: 'no_dates' });
        await refusal({ fromDay: '2026-10-31', rulesSha256: r2.sha256 }, { status: 'outside_dates' });
        await refusal({ toDay: '2026-12-01', rulesSha256: r2.sha256 }, { status: 'outside_dates' });
        await refusal({ rulesSha256: 'e'.repeat(64) }, { status: 'no_rules' });
        await refusal({ catalogSha256: 'e'.repeat(64) }, { status: 'no_catalog' });
        // Versions loaded by other code (loadRules and loadCatalog refuse them here).
        const rules = (/** @type {string} */ id, /** @type {string} */ hex, /** @type {string} */ algorithm, /** @type {object} */ params) => {
            pool.state.rules.push({ id, algorithm, sha256: hex.repeat(64), params, loaded_by: 'test', note: 'test' });
            return hex.repeat(64);
        };
        const v2 = { ...structuredClone(RULES_IN), algorithm: 'study-time/v2' };
        await refusal({ rulesSha256: rules('900', '9', 'study-time/v2', v2) }, { status: 'invalid_version', which: 'rules', cause: 'unknown' });
        await refusal({ rulesSha256: rules('901', '8', 'study-time/v1', v2) }, { status: 'invalid_version', which: 'rules', cause: 'rules_row' });
        await refusal({ rulesSha256: rules('902', '7', 'study-time/v9', structuredClone(RULES_IN)) }, { status: 'invalid_version', which: 'rules', cause: 'rules_row' });
        await refusal({ rulesSha256: rules('903', '6', 'study-time/v1', { ...structuredClone(RULES_IN), counting: { ...RULES_IN.counting, gapMs: 1 } }) }, { status: 'invalid_version', which: 'rules', cause: 'unparsed' });
        pool.state.catalogs.push({ id: '904', course_key: COURSE.courseKey, sha256: '5'.repeat(64), manifest: { ...structuredClone(COURSE), schema: 'risepath.training-course/v9' }, loaded_by: 'test', note: 'test' });
        await refusal({ catalogSha256: '5'.repeat(64) }, { status: 'invalid_version', which: 'catalog', cause: 'unparsed' });
        // A stored setting that no longer parses (R1, the setting's rules).
        pool.state.rules[0].params.counting.gapMs = 1;
        await refusal({ rulesSha256: r2.sha256 }, { error: 'A stored rules or unit list version does not parse with this code.', error_type: 'invalid_setting' });
        pool.state.rules[0].params.counting.gapMs = 23 * S;
        // 01:00 JST on 11-04: 11-03 is final under R1's 23 s (closed), not under WIDE's 6 hours.
        pool.setClock(at('2026-11-03T16:00:00Z'));
        await refusal({ fromDay: '2026-11-03', toDay: '2026-11-03', rulesSha256: wide.sha256 }, { status: 'not_final', day: '2026-11-03' });
        // Between 11-03's end + NARROW's 11 s and + its setting's 23 s: final under the override's only.
        // A unit list alone takes the setting's.
        const edge = jstDayRange('2026-11-03').end + 23 * S;
        pool.setClock(edge - 6 * S);
        await refusal({ fromDay: '2026-11-03', toDay: '2026-11-03', rulesSha256: narrow.sha256 }, { status: 'not_final', day: '2026-11-03' });
        await refusal({ fromDay: '2026-11-03', toDay: '2026-11-03', catalogSha256: k3.sha256 }, { status: 'not_final', day: '2026-11-03' });
        pool.setClock(edge);
        await refusal({ fromDay: '2026-11-03', toDay: '2026-11-03', catalogSha256: k3.sha256 }, { status: 'not_final', day: '2026-11-03' });
        pool.setClock(edge + 1);
        assert.equal((await dry(pool, { fromDay: '2026-11-03', toDay: '2026-11-03', catalogSha256: k3.sha256 })).status, 'plan', 'strictly after the end + gapMs');
        assert.equal((await dry(pool, { fromDay: '2026-11-03', toDay: '2026-11-03', rulesSha256: narrow.sha256 })).status, 'plan');
    });

    it('after every learner was read, in one order whatever the learners\' order: closed days that do not check (with the check\'s differences), then days not closed up to --to, then another course (the day only)', async () => {
        for (const faulty of [A, B]) {
            const other = faulty === A ? B : A;
            const { pool, r2 } = await seeded({ learners: [A, B] });
            await close(pool, faulty);
            const k = /** @type {any} */ (await loadCatalog({ input: OTHER_COURSE, loadedBy: 'staff-a', note: 'other', pool }));
            rowOf(pool, '2026-11-01', faulty).counted_ms = 1;
            for (const over of [{ rulesSha256: r2.sha256 }, { catalogSha256: k.sha256 }]) {
                const refused = await dry(pool, over);
                assert.equal(refused.status, 'unverified', `${faulty} ${JSON.stringify(over)}`);
                assert.deepEqual(refused.learners.map((/** @type {any} */ l) => [l.userId, l.differences.map((/** @type {any} */ d) => [d.day, d.what])]), [[faulty, [['2026-11-01', 'values']]]]);
                assert.equal((await write(pool, { ...over, expect: 'a'.repeat(64) })).status, 'unverified');
            }
            rowOf(pool, '2026-11-01', faulty).counted_ms = 70 * S;
            assert.deepEqual(await dry(pool, { catalogSha256: k.sha256 }), { status: 'not_closed', learners: [other] });
            await close(pool, other);
            assert.deepEqual(await dry(pool, { catalogSha256: k.sha256 }), { status: 'course_differs', day: '2026-11-01' });
            assert.deepEqual(await dry(pool, { fromDay: '2026-11-02', toDay: '2026-11-03', catalogSha256: k.sha256 }), { status: 'course_differs', day: '2026-11-02' });
            assert.deepEqual(pool.state.recounts, []);
        }
        // Both learners' rows do not check: both are listed, in id order.
        const both = await seeded({ learners: [B, A] });
        for (const user of [A, B]) {
            await close(both.pool, user);
            rowOf(both.pool, '2026-11-02', user).over_cap_ms = 1;
        }
        const listed = await dry(both.pool, { rulesSha256: both.r2.sha256 });
        assert.deepEqual([listed.status, listed.learners.map((/** @type {any} */ l) => l.userId)], ['unverified', [A, B]]);
        // A stored setting that stops parsing after the first snapshot (read again in each learner's).
        both.pool.before(RECOUNT_SQL.learnerMember, () => { both.pool.state.rules[0].params.counting.gapMs = 1; });
        assert.equal((await dry(both.pool, { rulesSha256: both.r2.sha256 })).error_type, 'invalid_setting');
        // A learner whose closed days stop before --to (closed at 00:00:10 JST on 11-04: through 11-02 only).
        const { pool, r2 } = await seeded({ learners: [A] });
        pool.setClock(at('2026-11-03T15:00:10Z'));
        await close(pool);
        assert.deepEqual(DAYS.map((day) => Boolean(rowOf(pool, day))), [true, true, false]);
        pool.setClock(at('2026-11-04T03:00:00Z'));
        assert.deepEqual(await dry(pool, { toDay: '2026-11-03', rulesSha256: r2.sha256 }), { status: 'not_closed', learners: [A] });
        assert.equal((await dry(pool, { toDay: '2026-11-02', rulesSha256: r2.sha256 })).status, 'plan');
    });

    it('learners: one whose first day is after --to is skipped (not read past its setting, not locked); one whose days do not change is locked and its rows read again, but gets no row', async () => {
        const { pool, r2, catalog } = await seeded({ learners: [A, B, C], study: [A, C] });
        // C was added on 11-02 (10:00 JST): its first day is after --to.
        pool.state.memberships.find((/** @type {any} */ m) => m.user_id === C).added_at = at('2026-11-02T01:00:00Z');
        for (const user of [A, B, C]) await close(pool, user);
        // B studied nothing, and an earlier recount already gave its 11-01 R2's versions (and 0 s).
        const zero = rowOf(pool, '2026-11-01', B);
        pool.addRecount({ cohortId: COHORT, fromDay: '2026-11-01', toDay: '2026-11-01', ruleSetId: r2.id,
            rows: [{ userId: B, day: '2026-11-01', ruleSetId: r2.id, catalogId: catalog.id, countedMs: 0, overCapMs: 0, signals: zero.signals, evidenceSha256: zero.evidence_sha256, units: [] }] });
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        assert.deepEqual(changedOf(plan), [[A, [['2026-11-01', 70, 0, 50, 0], ['2026-11-02', 50, 20, 70, 0]]]]);
        const sent0 = pool.queries.length;
        const written = await write(pool, { rulesSha256: r2.sha256, expect: plan.sha256 });
        assert.deepEqual([written.status, written.learners, written.days], ['recounted', 1, 2]);
        const sent = pool.queries.slice(sent0);
        const of = (/** @type {string} */ sql) => sent.filter((q) => q.sql === sql).map((q) => q.params[0]);
        assert.deepEqual([of(TRAINING_SQL.lock), of(TRAINING_SQL.learnerLock), of(RECOUNT_SQL.fingerprint)], [[A, B], [A, B], [A, B]], 'A and B, not C');
        assert.deepEqual(of(RECOUNT_SQL.insertRecountDays), [A], 'rows for A only');
        assert.deepEqual([of(RECOUNT_SQL.learnerMember), of(CHECK_SQL.learnerRows)], [[A, B, C], [A, B]], 'C\'s rows are not read');
        assert.deepEqual(await values(pool, C), [['2026-11-02', 'close', 70, 0], ['2026-11-03', 'close', 50, 20]]);
        assert.deepEqual((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }))).learners.map((/** @type {any} */ l) => l.differences), [[], [], []]);
    });
});

describe('tools/core/trainingTimeRecount.js: the write', () => {
    it('the dry run again, then one READ COMMITTED transaction: the 20 ms lock timeout, each counted learner\'s account lock (shared) and training lock in id order, the tables\' locks and their indexes, each learner\'s rows and evidence count read again as its snapshot read them, the record, each changed learner\'s rows (day order) and units; the old rows stay, the new current values check; again: nothing to write and no lock', async () => {
        const { pool, r2 } = await seeded({ learners: [B, A] });
        await close(pool, A);
        await close(pool, B);
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        const sent0 = pool.queries.length;
        const written = await write(pool, { rulesSha256: r2.sha256, expect: plan.sha256 });
        assert.deepEqual(written, { status: 'recounted', id: pool.state.recounts[0].id, learners: 2, days: 4, sha256: plan.sha256 });
        const sent = pool.queries.slice(sent0);
        const tries = triesOf(sent);
        assert.deepEqual(tries.map((t) => t[0]), [SNAPSHOT, SNAPSHOT, SNAPSHOT, 'BEGIN'], 'the dry run (the cohort, A, B), then the write');
        assert.deepEqual(tries[3], [
            'BEGIN', TRAINING_SQL.lockTimeout, CHECK_SQL.tryLockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_SQL.lock, TRAINING_SQL.learnerLock,
            ...RECOUNT_LOCKS.write, RECOUNT_SQL.fingerprint, RECOUNT_SQL.fingerprint, RECOUNT_SQL.insertRecount,
            RECOUNT_SQL.insertRecountDays, TRAINING_TIME_SQL.insertUnitDays, RECOUNT_SQL.insertRecountDays, TRAINING_TIME_SQL.insertUnitDays, 'COMMIT',
        ]);
        const params = (/** @type {string} */ sql) => sent.filter((q) => q.sql === sql).map((q) => q.params);
        assert.deepEqual([params(TRAINING_SQL.lock), params(TRAINING_SQL.learnerLock)], [[[A], [B]], [[A], [B]]], 'learners added B then A are locked A, B');
        assert.deepEqual(params(RECOUNT_SQL.fingerprint), params(TRAINING_TIME_SQL.evidence), 'each learner\'s evidence read, with the same days and instants');
        assert.deepEqual(params(RECOUNT_SQL.insertRecount), [[COHORT, '2026-11-01', '2026-11-01', r2.id, null, plan.sha256, 'staff-a', 'the provider confirmed new rules']]);
        assert.deepEqual(params(RECOUNT_SQL.insertRecountDays).map((p) => [p[0], p[2], p[3], p[4]]), [[A, 'staff-a', written.id, ['2026-11-01', '2026-11-02']], [B, 'staff-a', written.id, ['2026-11-01', '2026-11-02']]]);
        assert.deepEqual(Object.keys(pool.state.recounts[0]).filter((k) => /user|counted|learner|day_id|signals/.test(k)), [], 'no learner and no learner value in the record');
        for (const user of [A, B]) assert.deepEqual(await values(pool, user), [['2026-11-01', 'recompute', 50, 0], ['2026-11-02', 'recompute', 70, 0], ['2026-11-03', 'close', 0, 70]]);
        const rows = pool.state.days.filter((/** @type {any} */ d) => d.user_id === A);
        assert.deepEqual(rows.map((/** @type {any} */ d) => [d.day, d.kind, d.recompute_id, d.computed_by]), [
            ['2026-11-01', 'close', null, 'staff'], ['2026-11-02', 'close', null, 'staff'], ['2026-11-03', 'close', null, 'staff'],
            ['2026-11-01', 'recompute', written.id, 'staff-a'], ['2026-11-02', 'recompute', written.id, 'staff-a'],
        ], 'the old rows stay; the recount rows name it, in day order');
        assert.deepEqual(pool.state.unitDays.filter((/** @type {any} */ u) => u.day_id === rows[4].id).map((/** @type {any} */ u) => [u.unit_key, u.counted_ms, u.over_cap_ms]), [[U1, 70 * S, 0]]);
        assert.deepEqual((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }))).learners.map((/** @type {any} */ l) => l.differences), [[], []],
            'the recount rows check (their versions: the override, and the replaced row\'s)');
        // The same plan again: nothing is left to change; the write takes no lock.
        const again = await dry(pool, { rulesSha256: r2.sha256 });
        assert.deepEqual(again.learners, []);
        const sent1 = pool.queries.length;
        assert.deepEqual(await write(pool, { rulesSha256: r2.sha256, expect: again.sha256 }), { status: 'unchanged', sha256: again.sha256 });
        assert.deepEqual(triesOf(pool.queries.slice(sent1)).map((t) => t[0]), [SNAPSHOT, SNAPSHOT, SNAPSHOT], 'the dry run only');
    });

    it('a plan that changed since the dry run is refused and nothing is written: another sha256 or reason (before any lock); under the locks, another session\'s close of a later day, signal in the evidence read, deletion or recount (committed while the write waited for its first learner\'s lock, kept after the rollback); a signal outside the evidence read changes nothing', async () => {
        const fresh = async () => {
            const s = await seeded({ learners: [A, B] });
            await close(s.pool, A);
            await close(s.pool, B);
            const plan = await dry(s.pool, { rulesSha256: s.r2.sha256 });
            return { ...s, plan, again: (/** @type {object} */ over = {}) => write(s.pool, { rulesSha256: s.r2.sha256, expect: plan.sha256, ...over }) };
        };
        const { pool, plan, again } = await fresh();
        const sent0 = pool.queries.length;
        assert.deepEqual(await again({ expect: 'f'.repeat(64) }), { status: 'plan_changed' });
        assert.deepEqual(await again({ reason: 'not the one reviewed' }), { status: 'plan_changed' });
        assert.deepEqual(await again({ recomputedBy: 'staff-b' }), { status: 'plan_changed' });
        assert.ok(!pool.queries.slice(sent0).some((q) => q.sql === 'BEGIN' || q.sql === TRAINING_SQL.learnerLock), 'no write transaction');
        assert.notEqual(plan.sha256, 'f'.repeat(64));
        /** @type {Array<[string, (s: any) => void, (s: any) => boolean]>} */
        const others = [
            ['a close of a later day', (s) => s.pool.elsewhere(() => s.pool.addClose({ userId: A, cohortId: COHORT, day: '2026-11-04', ruleSetId: s.r1.id, catalogId: s.catalog.id, countedMs: 0, overCapMs: 0, signals: 0, evidenceSha256: 'e'.repeat(64) })),
                (s) => Boolean(rowOf(s.pool, '2026-11-04'))],
            ['a signal in the evidence read', (s) => s.pool.elsewhere(() => chain(s.pool, A, 80, at('2026-11-02T05:00:00Z'), 1)), (s) => s.pool.state.signals.length === 67],
            ['a deletion', (s) => s.pool.deleteAccount(B, at('2026-11-04T03:00:00Z')), (s) => !rowOf(s.pool, '2026-11-01', B)],
            ['another recount', (s) => s.pool.elsewhere(() => s.pool.addRecount({ cohortId: COHORT, fromDay: '2026-11-02', toDay: '2026-11-02', ruleSetId: s.wide.id,
                rows: [{ userId: A, day: '2026-11-02', ruleSetId: s.wide.id, catalogId: s.catalog.id, countedMs: 50 * S, overCapMs: 20 * S, signals: 11, evidenceSha256: 'e'.repeat(64), units: [[U1, 50 * S, 20 * S]] }] })),
                (s) => s.pool.state.recounts.length === 1],
        ];
        for (const [what, commit, kept] of others) {
            const s = await fresh();
            let done = false;
            s.pool.before(TRAINING_SQL.learnerLock, () => {
                if (done) return;
                done = true;
                commit(s);
            });
            const sent = s.pool.queries.length;
            assert.deepEqual(await s.again(), { status: 'plan_changed' }, what);
            const tx = triesOf(s.pool.queries.slice(sent)).at(-1) ?? [];
            assert.deepEqual([tx[0], tx.at(-1), tx.includes(RECOUNT_SQL.insertRecount)], ['BEGIN', 'ROLLBACK', false], what);
            assert.ok(kept(s), `${what}: the other session's commit is kept`);
            assert.equal(s.pool.state.days.filter((/** @type {any} */ d) => d.kind === 'recompute' && d.computed_by === 'staff-a').length, 0, `${what}: nothing written`);
        }
        // A signal received after the evidence read's window (in a stream of a day it reads) changes nothing.
        const s = await fresh();
        let done = false;
        s.pool.before(TRAINING_SQL.learnerLock, () => {
            if (done) return;
            done = true;
            s.pool.elsewhere(() => chain(s.pool, A, 81, at('2026-11-04T02:00:00Z'), 1));
        });
        assert.equal((await s.again()).status, 'recounted');
    });

    it('a lock wait over 20 ms (an account\'s or a learner\'s lock, a table\'s, an index\'s) or a read meeting one rolls the try back, holding nothing; the next try starts 0.1 s after the last started (the dry run is not run again); for good, account_busy after LOCK_RETRY.tries tries; any other error ends it at once', async () => {
        for (const sql of [TRAINING_SQL.lock, TRAINING_SQL.learnerLock, RECOUNT_SQL.lockWritten, RECOUNT_SQL.lockReferenced, RECOUNT_SQL.lockRead, RECOUNT_SQL.indexesWrite, RECOUNT_SQL.fingerprint, RECOUNT_SQL.insertRecountDays]) {
            const { pool, r2 } = await seeded();
            await close(pool);
            const plan = await dry(pool, { rulesSha256: r2.sha256 });
            pool.failOn(sql, busy(), 1);
            const { slept, sleep, now } = fakeTime();
            const sent0 = pool.queries.length;
            assert.equal((await write(pool, { rulesSha256: r2.sha256, expect: plan.sha256, sleep, now })).status, 'recounted', sql);
            assert.deepEqual(slept, [LOCK_RETRY.everyMs], sql);
            const tries = triesOf(pool.queries.slice(sent0));
            assert.deepEqual(tries.map((t) => t[0]), [SNAPSHOT, SNAPSHOT, 'BEGIN', 'BEGIN'], `${sql}: the dry run once, the write twice`);
            assert.deepEqual([tries[2].at(-2), tries[2].at(-1), tries[3].at(-1)], [sql, 'ROLLBACK', 'COMMIT'], sql);
            assert.equal(pool.state.recounts.length, 1, sql);
            assert.equal(pool.state.days.filter((/** @type {any} */ d) => d.kind === 'recompute').length, 2, `${sql}: the rows once`);
        }
        // A learner's lock that stays held.
        const { pool, r2 } = await seeded();
        await close(pool);
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        pool.failOn(TRAINING_SQL.learnerLock, busy());
        const { slept, sleep, now } = fakeTime();
        const sent0 = pool.queries.length;
        assert.deepEqual(await write(pool, { rulesSha256: r2.sha256, expect: plan.sha256, sleep, now }), { error: 'A lock stayed held. Try again.', error_type: 'account_busy' });
        assert.deepEqual([pool.queries.slice(sent0).filter((q) => q.sql === 'BEGIN').length, slept.length], [LOCK_RETRY.tries, LOCK_RETRY.tries - 1]);
        assert.deepEqual(pool.state.recounts, []);
        // Any other error: at once, unretried.
        const { pool: other, r2: r } = await seeded();
        await close(other);
        const p = await dry(other, { rulesSha256: r.sha256 });
        other.failOn(RECOUNT_SQL.fingerprint, missing(), 1);
        const time = fakeTime();
        const sent1 = other.queries.length;
        assert.equal((await write(other, { rulesSha256: r.sha256, expect: p.sha256, sleep: time.sleep, now: time.now })).error_type, 'table_not_found');
        assert.deepEqual([other.queries.slice(sent1).filter((q) => q.sql === 'BEGIN').length, time.slept], [1, []]);
    });

    it('the dry run\'s read locks: a LOCK … NOWAIT or a read that meets a held lock rolls the snapshot back and tries again (the same plan); any other error ends it at once', async () => {
        const { pool, r2 } = await seeded({ learners: [A, B] });
        await close(pool, A);
        await close(pool, B);
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        for (const sql of [RECOUNT_LOCKS.head[0], RECOUNT_LOCKS.learner[0], RECOUNT_LOCKS.learner[2], CHECK_SQL.learnerRows]) {
            pool.failOn(sql, busy(), 1);
            const { slept, sleep, now } = fakeTime();
            assert.equal((/** @type {any} */ (await planRecount({ ...recount(pool, { rulesSha256: r2.sha256 }), sleep, now }))).sha256, plan.sha256, sql);
            assert.deepEqual(slept, [LOCK_RETRY.everyMs], sql);
        }
        pool.failOn(RECOUNT_LOCKS.learner[0], busy());
        const held = fakeTime();
        assert.equal((/** @type {any} */ (await planRecount({ ...recount(pool, { rulesSha256: r2.sha256 }), sleep: held.sleep, now: held.now }))).error_type, 'account_busy');
        assert.equal(held.slept.length, LOCK_RETRY.tries - 1);
        const { pool: other, r2: r } = await seeded();
        await close(other);
        other.failOn(CHECK_SQL.learnerRows, missing(), 1);
        const time = fakeTime();
        assert.equal((/** @type {any} */ (await planRecount({ ...recount(other, { rulesSha256: r.sha256 }), sleep: time.sleep, now: time.now }))).error_type, 'table_not_found');
        assert.deepEqual(time.slept, []);
    });

    it('a stub gone before the rows are written (a fault the locks rule out): unknown, rolled back, no record', async () => {
        const { pool, r2 } = await seeded();
        await close(pool);
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        pool.before(RECOUNT_SQL.insertRecountDays, () => { pool.state.stubs = pool.state.stubs.filter((/** @type {string} */ s) => s !== A); });
        assert.deepEqual(await write(pool, { rulesSha256: r2.sha256, expect: plan.sha256 }), { error: 'The recount could not be written.', error_type: 'unknown' });
        assert.equal(pool.tx().at(-1), 'ROLLBACK');
        assert.deepEqual(pool.state.recounts, []);
    });

    it('the statements: each snapshot\'s LOCK locks exactly the tables its reads use (ACCESS SHARE), and its read of no rows names them; the write locks the tables it inserts into (ROW EXCLUSIVE), those their foreign keys reference (ROW SHARE) and those its statements read (ACCESS SHARE), exactly, and names all of them in its read of no rows; the fingerprint counts the evidence read with that read\'s own text', () => {
        const lockOf = (/** @type {readonly string[]} */ locks) => [...lockedBy(locks[0])].sort();
        assert.deepEqual(reads([TRAINING_SQL.cohortBySlug, TRAINING_TIME_SQL.learners, RECOUNT_SQL.rulesBySha, RECOUNT_SQL.catalogBySha, TRAINING_TIME_SQL.closeSettings, RECOUNT_SQL.clock]), lockOf(RECOUNT_LOCKS.head));
        assert.deepEqual(reads([RECOUNT_SQL.learnerMember, TRAINING_TIME_SQL.closeSettings, CHECK_SQL.learnerRows, CHECK_SQL.unitRows, CHECK_SQL.rulesByIds, CHECK_SQL.catalogsByIds,
            CHECK_SQL.recountsByIds, TRAINING_TIME_SQL.evidence]), lockOf(RECOUNT_LOCKS.learner));
        assert.deepEqual(reads([CHECK_SQL.learnerRows, TRAINING_TIME_SQL.unitTotals]), lockOf(RECOUNT_LOCKS.history));
        for (const locks of [RECOUNT_LOCKS.head, RECOUNT_LOCKS.learner, RECOUNT_LOCKS.history]) {
            assert.match(locks[0], /^LOCK TABLE [a-z_., ]+ IN ACCESS SHARE MODE NOWAIT$/);
            assert.deepEqual(locks.slice(1), [CHECK_SQL.tryLockTimeout, `SELECT 1 FROM ${lockedBy(locks[0]).join(', ')} LIMIT 0`]);
        }
        // The write's statements, after its locks.
        const statements = [RECOUNT_SQL.fingerprint, RECOUNT_SQL.insertRecount, RECOUNT_SQL.insertRecountDays, TRAINING_TIME_SQL.insertUnitDays];
        const inserted = [...new Set(statements.flatMap((sql) => [...sql.matchAll(/\bINSERT INTO (\S+)/g)].map((m) => bare(m[1]))))].sort();
        assert.deepEqual(inserted, [...lockedBy(RECOUNT_SQL.lockWritten)].sort());
        const referenced = [...new Set(inserted.flatMap(referencedBy))].filter((t) => !inserted.includes(t)).sort();
        assert.deepEqual(referenced, [...lockedBy(RECOUNT_SQL.lockReferenced)].sort());
        assert.deepEqual(reads(statements).filter((t) => !inserted.includes(t) && !referenced.includes(t)), [...lockedBy(RECOUNT_SQL.lockRead)].sort());
        assert.deepEqual([RECOUNT_SQL.lockWritten, RECOUNT_SQL.lockReferenced, RECOUNT_SQL.lockRead].map((sql) => sql.replace(/^LOCK TABLE [a-z_., ]+ IN /, '')), ['ROW EXCLUSIVE MODE NOWAIT', 'ROW SHARE MODE NOWAIT', 'ACCESS SHARE MODE NOWAIT']);
        assert.equal(RECOUNT_SQL.indexesWrite, `SELECT 1 FROM ${[RECOUNT_SQL.lockWritten, RECOUNT_SQL.lockReferenced, RECOUNT_SQL.lockRead].flatMap(lockedBy).join(', ')} LIMIT 0`);
        assert.deepEqual(RECOUNT_LOCKS.write, [RECOUNT_SQL.lockWritten, RECOUNT_SQL.lockReferenced, RECOUNT_SQL.lockRead, RECOUNT_SQL.indexesWrite]);
        // The fingerprint: the live rows in day and id order, and the evidence read itself, counted.
        assert.ok(RECOUNT_SQL.fingerprint.endsWith(`(SELECT count(*) FROM (${TRAINING_TIME_SQL.evidence}) e) AS evidence`));
        assert.match(RECOUNT_SQL.fingerprint, /^SELECT \(SELECT coalesce\(array_agg\(id::text ORDER BY day, id\), '\{\}'\) FROM training_time_days\n\s+WHERE user_id = \$1::uuid AND cohort_id = \$2::uuid AND account_deleted_at IS NULL\) AS day_ids,\n/);
        // The rows: only while the stub exists, in day order, naming the record; the record: no learner.
        assert.match(RECOUNT_SQL.insertRecountDays, /'recompute', d\.algorithm, [^\n]+, \$3, \$4\n/);
        assert.match(RECOUNT_SQL.insertRecountDays, /\n WHERE EXISTS \(SELECT 1 FROM auth\.users WHERE id = \$1::uuid\)\n ORDER BY d\.ord\nRETURNING id, to_char\(day, 'YYYY-MM-DD'\) AS day$/);
        assert.match(RECOUNT_SQL.insertRecount, /^INSERT INTO training_time_recomputes \(cohort_id, from_day, to_day, rule_set_id, catalog_version_id, plan_sha256, recomputed_by, reason\)\n/);
        assert.match(RECOUNT_SQL.learnerMember, /WHERE m\.user_id = \$1::uuid AND m\.cohort_id = \$2::uuid AND m\.role = 'learner' AND m\.account_deleted_at IS NULL$/);
        assert.equal(RECOUNT_SQL.clock, 'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms');
    });
});

describe('the clock guard and the staff reads', () => {
    it('a recount of the last closed day with a wider gapMs widens the guard (a signal at its end + that gap stores nothing, 1 ms later it is stored); a narrower recount does not narrow it; a marked row is not read', async () => {
        const { pool, wide, narrow } = await seeded();
        await close(pool);
        const day = { fromDay: '2026-11-03', toDay: '2026-11-03' };
        const plan = await dry(pool, { ...day, rulesSha256: wide.sha256 });
        assert.equal((await write(pool, { ...day, rulesSha256: wide.sha256, expect: plan.sha256 })).status, 'recounted');
        const narrower = await dry(pool, { ...day, rulesSha256: narrow.sha256 });
        assert.deepEqual(changedOf(narrower), [[A, [['2026-11-03', 0, 70, 0, 70]]]], 'a version change');
        assert.equal((await write(pool, { ...day, rulesSha256: narrow.sha256, expect: narrower.sha256 })).status, 'recounted');
        const signal = (/** @type {number} */ n) => ({ unitKey: U1, chainId: chainId(n), seq: 0, stop: false, focus: true, input: true });
        const send = async (/** @type {number} */ clock, /** @type {number} */ n) => {
            pool.setClock(clock);
            return /** @type {any} */ (await recordSignal({ userId: A, cohortId: COHORT, signal: signal(n), pool })).status;
        };
        const end = jstDayRange('2026-11-03').end;
        assert.equal(await send(end + 6 * 60 * 60 * S, 70), 'clock_behind', 'the WIDE row\'s gap, not the newer NARROW row\'s');
        assert.equal(await send(end + 6 * 60 * 60 * S + 1, 71), 'accepted');
        // Without the WIDE row (marked): the close row's 23 s, wider than NARROW's 11 s.
        pool.state.days.find((/** @type {any} */ d) => d.day === '2026-11-03' && d.rule_set_id === wide.id).account_deleted_at = at('2026-11-04T03:00:00Z');
        assert.equal(await send(end + 23 * S, 72), 'clock_behind');
        assert.equal(await send(end + 23 * S + 1, 73), 'accepted');
    });

    it('a cohort\'s recounts (who, why, when, the days, the versions and the plan by sha256); a learner\'s rows (each day\'s earlier rows and the recount that wrote each, no row\'s time) and units, in one snapshot', async () => {
        const { pool, r2 } = await seeded();
        await close(pool);
        const plan = await dry(pool, { rulesSha256: r2.sha256 });
        const written = await write(pool, { rulesSha256: r2.sha256, expect: plan.sha256 });
        const list = /** @type {any} */ (await cohortRecounts({ cohortId: COHORT, pool }));
        assert.deepEqual(list, [{
            id: written.id, recomputedAt: new Date(at('2026-11-04T03:00:00Z')).toISOString(), recomputedBy: 'staff-a', reason: 'the provider confirmed new rules',
            fromDay: '2026-11-01', toDay: '2026-11-01', rulesSha256: r2.sha256, catalogSha256: null, planSha256: plan.sha256,
        }]);
        const sent0 = pool.queries.length;
        const history = /** @type {any} */ (await learnerHistory({ userId: A.toUpperCase(), cohortId: COHORT, pool }));
        assert.deepEqual(triesOf(pool.queries.slice(sent0)), [[SNAPSHOT, TRAINING_SQL.lockTimeout, ...RECOUNT_LOCKS.history, CHECK_SQL.learnerRows, TRAINING_TIME_SQL.unitTotals, 'ROLLBACK']]);
        assert.equal(history.userId, A);
        assert.deepEqual(history.rows.map((/** @type {any} */ r) => [r.day, r.kind, r.countedMs / S, r.overCapMs / S, r.signals, r.recomputeId, r.computedBy]), [
            ['2026-11-01', 'close', 70, 0, 11, null, 'staff'], ['2026-11-01', 'recompute', 50, 0, 11, written.id, 'staff-a'],
            ['2026-11-02', 'close', 50, 20, 11, null, 'staff'], ['2026-11-02', 'recompute', 70, 0, 11, written.id, 'staff-a'],
            ['2026-11-03', 'close', 0, 70, 11, null, 'staff'],
        ]);
        assert.ok(history.rows.every((/** @type {any} */ r) => Object.keys(r).every((k) => !/time|At$/i.test(k))), 'no row\'s time (D9)');
        assert.deepEqual(history.units, [{ unitKey: U1, countedMs: 120 * S, overCapMs: 70 * S }]);
        assert.equal((/** @type {any} */ (await learnerHistory({ userId: 'nope', cohortId: COHORT, pool }))).error_type, 'validation');
        pool.failOn(RECOUNT_LOCKS.history[0], busy());
        const { slept, sleep, now } = fakeTime();
        assert.equal((/** @type {any} */ (await learnerHistory({ userId: A, cohortId: COHORT, pool, sleep, now }))).error_type, 'account_busy');
        assert.equal(slept.length, LOCK_RETRY.tries - 1);
        assert.equal((/** @type {any} */ (await cohortRecounts({ cohortId: COHORT, pool: null }))).error_type, 'db_connection');
    });
});
