// Job training, the check of closed study time days (tools/core/trainingTimeCheck.js;
// doc/brushup-2026/training-plan.ja.md §4.9, D12), on the in-memory tables of
// server/tests/helpers/trainingTimePool.js. Pinned here:
// - the counting versions (shared/training/countingVersions.js): study-time/v1 is the study time
//   functions themselves; an unknown version is no version; the module imports only ./studyTime.js;
// - the check: every current row of a learner, in day order with the units carried from the stored
//   rows, against its versions, its provenance (a close row: the cohort's setting of its day; a
//   recount row: its recount's override inside the recount's days, the row it replaced for the
//   version not overridden and outside those days), its evidence (count and sha256 of its window) and
//   its values (counted, over the set time, each unit); the cohort and its learners in one snapshot,
//   then one per learner (the snapshot BEGIN, the tables locked for reading before the first SELECT,
//   every read on its client), no advisory lock, nothing written; a stored setting that does not
//   parse stops it; a 'version' difference names its cause;
// - each day with its own version's evidence window (R2 looks further back and ahead than R1), with
//   chains across 00:00 JST, and with its own day's setting after a later one is added;
// - the units compared in code-unit order, whatever order the database's collation gives the rows;
// - the statements: the snapshot's text, every table read locked, the filters (a learner's live rows
//   of this cohort; the rest by id).
// The single snapshot and the migration on PostgreSQL 16 are proved by scripts/db/verify-training.mjs
// (T17, T18). Every rule value here is artificial.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COUNTING_VERSIONS, countingVersion } from '../../shared/training/countingVersions.js';
import { setMsOf } from '../../shared/training/courseManifest.js';
import { STUDY_TIME_ALGORITHM, cohortRange, countDay, evidenceWindow, jstDayRange } from '../../shared/training/studyTime.js';
import { parseTimeRules } from '../../shared/training/timeRules.js';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { TRAINING_TIME_SQL, closeDays, evidenceDigest, loadCatalog, loadRules, signalOf } from '../../tools/core/trainingTime.js';
import { CHECK_SQL, verifyCohort } from '../../tools/core/trainingTimeCheck.js';
import { AUTH_SQL, createTrainingTimePool } from './helpers/trainingTimePool.js';

const S = 1000;
const A = 'aaaaaaaa-2222-4000-8000-0000000000a1';
const B = 'aaaaaaaa-2222-4000-8000-0000000000b2';
const COHORT = 'c2200000-0000-4000-8000-000000000001';
const OTHER_COHORT = 'c2200000-0000-4000-8000-000000000002';
const SLUG = 'web-2026-11';
// Artificial rules: a pair counts up to 13 s (R1) or 5 s (R2). R2 also reads its evidence from further
// back and ahead (gapMs 29 s and idleMs 151 s, R1's 23 s and 101 s), so a day's evidence depends on
// the version it is counted with.
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7 * S, minSpacingMs: 3 * S, maxPlaces: 3 },
    counting: { gapMs: 23 * S, creditCapMs: 13 * S, idleMs: 101 * S, requireFocus: false, overlap: 'prefer_focus_latest' },
});
const RULES_IN_2 = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 29 * S, creditCapMs: 5 * S, idleMs: 151 * S } });
const RULES_2 = /** @type {any} */ (parseTimeRules(RULES_IN_2)).rules;
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));
// A second version of the unit list: only sample-u2's set time differs (no learner here studies it).
const COURSE_2 = { ...COURSE, units: COURSE.units.map((/** @type {any} */ u) => (u.key === 'sample-u2' ? { ...u, setMinutes: 31 } : u)) };
const U1 = 'sample-u1'; // 2 minutes
const U2 = 'sample-u2'; // 30 minutes
const at = (iso) => Date.parse(iso);
const chainId = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03'];

/**
 * A cohort of November 2026 with A and B as learners added on 10-31 JST, the unit list K1 and the
 * rules R1 in effect from 11-01, R2 and the unit list K2 loaded, and 11 signals 7 s apart on sample-u1
 * at 10:00 JST of each day of DAYS for each learner (70 s a day: 70, 50 + 20 over, 0 + 70 over).
 * `setup` (more versions, settings or signals) runs before the days are closed.
 * @param {(s: { pool: any, catalog: any, k2: any, r1: any, r2: any }) => unknown} [setup]
 */
async function seeded(setup) {
    const pool = createTrainingTimePool({
        clock: at('2026-11-04T03:00:00Z'),
        stubs: [A, B],
        cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }, { id: OTHER_COHORT, slug: 'other', name: 'Other', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
        memberships: [A, B].map((user) => ({ user_id: user, cohort_id: COHORT, added_at: at('2026-10-31T01:00:00Z') })),
    });
    const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'staff-a', note: 'sample', pool }));
    const k2 = /** @type {any} */ (await loadCatalog({ input: COURSE_2, loadedBy: 'staff-a', note: 'sample', pool }));
    const r1 = /** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'staff-a', note: 'sample', pool }));
    const r2 = /** @type {any} */ (await loadRules({ input: RULES_IN_2, loadedBy: 'staff-a', note: 'sample', pool }));
    pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: r1.id, effectiveFrom: '2026-11-01' });
    let n = 0;
    for (const user of [A, B]) {
        for (const day of DAYS) {
            n += 1;
            chain(pool, user, n, at(`${day}T01:00:00Z`), 11);
        }
    }
    await setup?.({ pool, catalog, k2, r1, r2 });
    for (const user of [A, B]) await closeDays({ userId: user, cohortId: COHORT, computedBy: 'staff', pool });
    return { pool, catalog, k2, r1, r2 };
}

/** A chain's signals stored for a learner: `count` of them 7 s apart from `from`, with focus and input. */
function chain(pool, user, n, from, count, unit = U1) {
    for (let seq = 0; seq < count; seq += 1) pool.addSignal({ userId: user, cohortId: COHORT, unit, chain: chainId(n), born: from, seq, at: from + seq * 7 * S, focus: true, input: true });
}

const check = async (pool, learner) => /** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, learner, pool }));
const differences = async (pool, learner = A) => (await check(pool, learner)).learners[0].differences.map((d) => [d.day, d.what]);
/** A's current row of a day (read each time: the pool's state is another object after a rollback). */
const rowOf = (pool, day) => pool.state.days.filter((d) => d.user_id === A && d.day === day).at(-1);
/** A's stored signals as the evidence read gives them (signalOf of TRAINING_TIME_SQL.evidence's rows). */
const signalsOfA = (pool) => pool.state.signals.flatMap((g) => {
    const s = pool.state.streams.find((x) => x.id === g.stream_id);
    return s.user_id === A ? [signalOf({ chain_id: s.chain_id, unit_key: s.unit_key, born: s.chain_started_at, seq: g.seq, at: g.received_at, flags: g.flags })] : [];
});

describe('shared/training/countingVersions.js', () => {
    it('study-time/v1 is the study time functions themselves; anything else is no version', () => {
        assert.deepEqual(Object.keys(COUNTING_VERSIONS), [STUDY_TIME_ALGORITHM]);
        assert.equal(countingVersion(STUDY_TIME_ALGORITHM)?.countDay, countDay);
        assert.equal(countingVersion(STUDY_TIME_ALGORITHM)?.evidenceWindow, evidenceWindow);
        for (const name of ['study-time/v2', 'study-time/v0', '', null, undefined, 'toString', '__proto__', 'constructor', 1]) assert.equal(countingVersion(name), null, String(name));
        assert.ok(Object.isFrozen(COUNTING_VERSIONS) && Object.isFrozen(COUNTING_VERSIONS[STUDY_TIME_ALGORITHM]));
    });

    it('imports only ./studyTime.js and reads no clock or randomness', () => {
        const code = fs.readFileSync(new URL('../../shared/training/countingVersions.js', import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.deepEqual([...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['./studyTime.js']);
        assert.doesNotMatch(code, /Date\.now|Math\.random|new Date\(\)|performance\./);
    });
});

describe('tools/core/trainingTimeCheck.js', () => {
    it('closed days check, every learner or one; the cohort and its learners in one snapshot, then each learner in one (every read after the snapshot BEGIN, on its client, its tables locked for reading first); no advisory lock, nothing written', async () => {
        const { pool } = await seeded();
        const sent0 = pool.queries.length;
        const checked = await check(pool);
        assert.equal(checked.status, 'checked');
        assert.deepEqual(checked.learners.map((l) => [l.userId, l.days, l.differences]), [[A, 3, []], [B, 3, []]], 'learners in id order');
        const sent = pool.queries.slice(sent0);
        assert.ok(sent.every((q) => q.tx), 'every statement in a transaction, on its client');
        const begins = sent.flatMap((q, i) => (q.sql === TRAINING_TIME_SQL.beginSnapshot ? [i] : []));
        assert.equal(begins.length, 3, 'the cohort, then one snapshot per learner');
        const inside = (/** @type {number} */ i) => sent.slice(i, sent.findIndex((q, j) => j > i && q.sql === 'ROLLBACK') + 1).map((q) => q.sql);
        assert.equal(inside(begins[0]).length + inside(begins[1]).length + inside(begins[2]).length, sent.length, 'nothing between them');
        // The cohort and its learners; then, for each learner, the setting, the rows, units, versions
        // and evidence; each snapshot's tables locked (ACCESS SHARE) before its first SELECT, then a rollback.
        assert.deepEqual(inside(begins[0]), [TRAINING_TIME_SQL.beginSnapshot, TRAINING_SQL.lockTimeout, CHECK_SQL.lockCohort, TRAINING_SQL.cohortBySlug, TRAINING_TIME_SQL.learners, 'ROLLBACK']);
        for (const i of begins.slice(1)) {
            assert.deepEqual(inside(i), [
                TRAINING_TIME_SQL.beginSnapshot, TRAINING_SQL.lockTimeout, CHECK_SQL.lockLearner, TRAINING_TIME_SQL.closeSettings, CHECK_SQL.learnerRows, CHECK_SQL.unitRows,
                CHECK_SQL.rulesByIds, CHECK_SQL.catalogsByIds, TRAINING_TIME_SQL.evidence, 'ROLLBACK',
            ]);
        }
        assert.ok(!sent.some((q) => [TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared, 'BEGIN', 'COMMIT'].includes(q.sql)), 'no advisory lock, no write transaction');
        // In that snapshot (as on PostgreSQL) any write is refused, so code that wrote there would fail.
        const client = await pool.connect();
        await client.query(TRAINING_TIME_SQL.beginSnapshot);
        await assert.rejects(client.query(AUTH_SQL.stubInsert, ['aaaaaaaa-2222-4000-8000-0000000000e1']), { code: '25006' });
        await assert.rejects(client.query(TRAINING_TIME_SQL.insertUnitDays, [[rowOf(pool, '2026-11-01').id], [U2], [S], [0]]), { code: '25006' });
        await client.query('ROLLBACK');
        const one = await check(pool, B.toUpperCase());
        assert.deepEqual(one.learners.map((l) => l.userId), [B]);
        assert.deepEqual(await verifyCohort({ cohortSlug: 'no-such', pool }), { status: 'no_cohort' });
        assert.deepEqual(await verifyCohort({ cohortSlug: SLUG, learner: 'aaaaaaaa-2222-4000-8000-0000000000e0', pool }), { status: 'not_a_learner' });
        assert.equal((await check(pool, 'nope')).error_type, 'validation');
        assert.equal((await verifyCohort({ cohortSlug: SLUG, pool: null })).error_type, 'db_connection');
    });

    it('the statements: the snapshot is REPEATABLE READ READ ONLY; each locks every table its reads use, in ACCESS SHARE mode; a learner\'s live rows of this cohort only (a deleted account\'s marked rows and another cohort\'s are not read), in day and id order; units, versions and recounts by id', () => {
        assert.equal(TRAINING_TIME_SQL.beginSnapshot, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        assert.equal(CHECK_SQL.lockCohort, 'LOCK TABLE training_cohorts, training_memberships IN ACCESS SHARE MODE');
        assert.equal(CHECK_SQL.lockLearner, 'LOCK TABLE training_cohort_time_settings, training_time_rule_sets, training_catalog_versions, training_time_days, '
            + 'training_time_unit_days, training_time_recomputes, training_time_streams, training_time_signals IN ACCESS SHARE MODE');
        const tablesOf = (/** @type {string} */ sql) => [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)\s/g)].map((m) => m[1]);
        const lockedBy = (/** @type {string} */ lock) => lock.replace(/^LOCK TABLE /, '').replace(/ IN ACCESS SHARE MODE$/, '').split(', ');
        const reads = (/** @type {string[]} */ sqls) => [...new Set(sqls.flatMap(tablesOf))].sort();
        assert.deepEqual(reads([TRAINING_SQL.cohortBySlug, TRAINING_TIME_SQL.learners]), [...lockedBy(CHECK_SQL.lockCohort)].sort());
        assert.deepEqual(reads([TRAINING_TIME_SQL.closeSettings, CHECK_SQL.learnerRows, CHECK_SQL.unitRows, CHECK_SQL.rulesByIds, CHECK_SQL.catalogsByIds, CHECK_SQL.recountsByIds, TRAINING_TIME_SQL.evidence]),
            [...lockedBy(CHECK_SQL.lockLearner)].sort());
        assert.match(CHECK_SQL.learnerRows, /\n {2}FROM training_time_days\n WHERE user_id = \$1::uuid AND cohort_id = \$2::uuid AND account_deleted_at IS NULL\n ORDER BY day, id$/);
        assert.match(CHECK_SQL.learnerRows, /^SELECT id, to_char\(day, 'YYYY-MM-DD'\) AS day, kind, algorithm, rule_set_id, catalog_version_id, counted_ms, over_cap_ms, signals,\n {7}evidence_sha256, recompute_id, computed_at, computed_by\n/);
        assert.match(CHECK_SQL.unitRows, / FROM training_time_unit_days WHERE day_id = ANY\(\$1::bigint\[\]\) ORDER BY day_id, unit_key$/);
        assert.match(CHECK_SQL.rulesByIds, / FROM training_time_rule_sets WHERE id = ANY\(\$1::bigint\[\]\) ORDER BY id$/);
        assert.match(CHECK_SQL.catalogsByIds, / FROM training_catalog_versions WHERE id = ANY\(\$1::bigint\[\]\) ORDER BY id$/);
        assert.match(CHECK_SQL.recountsByIds, /to_char\(from_day, 'YYYY-MM-DD'\) AS from_day, to_char\(to_day, 'YYYY-MM-DD'\) AS to_day, rule_set_id, catalog_version_id\n {2}FROM training_time_recomputes WHERE id = ANY\(\$1::bigint\[\]\) ORDER BY id$/);
    });

    it('differences: a changed value (that day only), evidence added to a closed window, a close row with another setting\'s versions, a version this code does not have', async () => {
        const { pool, r2 } = await seeded();
        rowOf(pool, '2026-11-01').counted_ms = 69 * S;
        pool.addSignal({ userId: A, cohortId: COHORT, unit: U1, chain: chainId(90), born: at('2026-11-02T05:00:00Z'), seq: 0, at: at('2026-11-02T05:00:00Z'), focus: true, input: true });
        const first = (await check(pool, A)).learners[0].differences;
        assert.deepEqual(first.map((d) => [d.day, d.what]), [['2026-11-01', 'values'], ['2026-11-02', 'evidence']]);
        assert.deepEqual([first[0].detail.stored.countedMs, first[0].detail.counted.countedMs], [69 * S, 70 * S]);
        assert.deepEqual(first[1].detail, { stored: 11, found: 12 });
        rowOf(pool, '2026-11-01').counted_ms = 70 * S;
        rowOf(pool, '2026-11-03').algorithm = 'study-time/v9';
        rowOf(pool, '2026-11-02').rule_set_id = r2.id;
        // 11-02 now names R2: not the setting of its day, and R2 gives other values than the row's.
        const found = (await check(pool, A)).learners[0].differences;
        assert.deepEqual(found.map((d) => [d.day, d.what]), [['2026-11-02', 'setting'], ['2026-11-02', 'evidence'], ['2026-11-02', 'values'], ['2026-11-03', 'version']]);
        assert.deepEqual([found[3].detail.cause, found[3].detail.algorithm, found[3].detail.rulesAlgorithm], ['row', 'study-time/v9', 'study-time/v1'], 'the row names another algorithm than its rules');
        assert.deepEqual(await differences(pool, B), [], 'B unchanged');
    });

    it('differences in one field: a stored signal\'s flags (the same count), the time over the set time alone, the rules row\'s own algorithm', async () => {
        const { pool, r1 } = await seeded();
        // 11-02's fourth signal without focus: focus is not required, so the values stay; the digest changes.
        const signalOf02 = () => pool.state.signals.find((g) => g.seq === 3 && g.stream_id === pool.state.streams.find((s) => s.user_id === A && s.day === '2026-11-02').id);
        signalOf02().flags = 4;
        assert.deepEqual(await differences(pool), [['2026-11-02', 'evidence']]);
        signalOf02().flags = 6;
        rowOf(pool, '2026-11-02').over_cap_ms += S;
        assert.deepEqual(await differences(pool), [['2026-11-02', 'values']]);
        rowOf(pool, '2026-11-02').over_cap_ms -= S;
        // The rules row says another algorithm than its rules: no day is counted with it.
        pool.state.rules.find((r) => r.id === r1.id).algorithm = 'study-time/v9';
        const found = (await check(pool, A)).learners[0].differences;
        assert.deepEqual(found.map((d) => [d.day, d.what, d.detail.cause, d.detail.rulesAlgorithm]), DAYS.map((day) => [day, 'version', 'rules_row', 'study-time/v9']));
    });

    it('a later setting (D12: other rules and unit list from 11-03, then one in the future): each closed day checks against its own day\'s setting; a close row naming another unit list differs', async () => {
        const { pool, k2, r2, catalog } = await seeded(({ pool: p, k2: k, r2: r }) => p.addSetting({ cohortId: COHORT, catalogId: k.id, ruleSetId: r.id, effectiveFrom: '2026-11-03' }));
        assert.deepEqual(DAYS.map((day) => [rowOf(pool, day).rule_set_id === r2.id, rowOf(pool, day).catalog_version_id === k2.id]), [[false, false], [false, false], [true, true]], 'closed with the setting of each day');
        assert.deepEqual(await differences(pool), []);
        pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: r2.id, effectiveFrom: '2026-11-10' });
        assert.deepEqual(await differences(pool), [], 'a setting from a later day changes no closed day');
        // K2 differs from K1 in a unit not studied: the same values, not the setting of 11-02.
        rowOf(pool, '2026-11-02').catalog_version_id = k2.id;
        assert.deepEqual(await differences(pool), [['2026-11-02', 'setting']]);
    });

    it('evidence windows: chains across 00:00 JST, into the first closed day, between two and out of the last, check clean, closed and then recounted with R2 (it reads further ahead); a signal stored later in the last day\'s margin after 00:00 is found', async () => {
        // 20 signals 7 s apart from 23:58:30 JST: the first more than gapMs but less than idleMs before
        // 00:00, the 18th (seq 17) at 00:00:29, inside R2's window of the day before (29 s), not R1's (23 s).
        const { pool, r2, catalog } = await seeded(({ pool: p }) => {
            for (const [n, from] of /** @type {Array<[number, string]>} */ ([[91, '2026-10-31T14:58:30Z'], [92, '2026-11-01T14:58:30Z'], [93, '2026-11-03T14:58:30Z']])) chain(p, A, n, at(from), 20, U2);
        });
        assert.deepEqual(await differences(pool), []);
        const closed = rowOf(pool, '2026-11-03');
        assert.ok(rowOf(pool, '2026-11-01').signals > 11 && closed.signals > 11, 'the chains are in the windows');
        // 11-03 recounted with R2, as a recount writes it: the stored units carried, R2's window.
        const signals = signalsOfA(pool);
        /** @type {Map<string, number>} */
        const carried = new Map();
        for (const d of ['2026-11-01', '2026-11-02']) for (const u of pool.state.unitDays.filter((x) => x.day_id === rowOf(pool, d).id)) carried.set(u.unit_key, (carried.get(u.unit_key) ?? 0) + u.counted_ms);
        const recounted = countDay({ day: '2026-11-03', signals, rules: RULES_2, setMs: setMsOf(COURSE), carriedMs: carried, cohort: cohortRange('2026-11-01', '2026-11-30') });
        const w = evidenceWindow(jstDayRange('2026-11-03').start, jstDayRange('2026-11-03').end, RULES_2.counting);
        const evidence = signals.filter((s) => s.at >= w.from && s.at <= w.to);
        const units = /** @type {Array<[string, number, number]>} */ (recounted.units.filter((u) => u.countedMs > 0 || u.overCapMs > 0).map((u) => [u.unit, u.countedMs, u.overCapMs]));
        pool.addRecount({ cohortId: COHORT, fromDay: '2026-11-03', toDay: '2026-11-03', ruleSetId: r2.id, rows: [{ userId: A, day: '2026-11-03', ruleSetId: r2.id, catalogId: catalog.id,
            countedMs: recounted.countedMs, overCapMs: units.reduce((n, u) => n + u[2], 0), signals: evidence.length, evidenceSha256: evidenceDigest(evidence), units }] });
        assert.equal(evidence.length, closed.signals + 1, 'R2 reads one more signal after 00:00');
        assert.deepEqual(await differences(pool), []);
        // 00:00:20 JST of 11-04, a chain of its own (no piece): inside 11-03's window (gapMs after its end).
        pool.addSignal({ userId: A, cohortId: COHORT, unit: U2, chain: chainId(94), born: at('2026-11-03T15:00:20Z'), seq: 0, at: at('2026-11-03T15:00:20Z'), focus: true, input: true });
        assert.deepEqual(await differences(pool), [['2026-11-03', 'evidence']]);
    });

    it('a day\'s units are compared in code-unit order, whatever order the database\'s collation gives the rows (en_US.utf8 puts unit1 before unit-b)', async () => {
        const keys = { ...COURSE, units: [...COURSE.units, { key: 'unit-b', title: { jp: 'B', en: 'B' }, setMinutes: 30 }, { key: 'unit1', title: { jp: '1', en: '1' }, setMinutes: 30 }] };
        const { pool } = await seeded(async ({ pool: p, r1 }) => {
            const k3 = /** @type {any} */ (await loadCatalog({ input: keys, loadedBy: 'staff-a', note: 'sample', pool: p }));
            p.addSetting({ cohortId: COHORT, catalogId: k3.id, ruleSetId: r1.id, effectiveFrom: '2026-11-03' });
            chain(p, A, 95, at('2026-11-03T03:00:00Z'), 11, 'unit-b');
            chain(p, A, 96, at('2026-11-03T05:00:00Z'), 6, 'unit1');
        });
        const day = rowOf(pool, '2026-11-03');
        const stored = (await pool.query(CHECK_SQL.unitRows, [[day.id]])).rows.map((u) => u.unit_key);
        assert.deepEqual([stored, [...stored].sort()], [[U1, 'unit1', 'unit-b'], [U1, 'unit-b', 'unit1']], 'the rows come in the collation\'s order');
        assert.deepEqual(await differences(pool), []);
    });

    it('the units carried are the stored ones: a changed unit row makes its day and the later days differ (they were counted after it)', async () => {
        const { pool } = await seeded();
        const day1 = rowOf(pool, '2026-11-01');
        pool.state.unitDays.find((u) => u.day_id === day1.id).counted_ms = 10 * S;
        assert.deepEqual(await differences(pool), [['2026-11-01', 'values'], ['2026-11-02', 'values'], ['2026-11-03', 'values']]);
    });

    it('recount rows: the recount\'s override inside its days (the row it replaced, the newest before it, for the version not overridden), the replaced row\'s versions outside them, each with its own evidence window; a row without its recount, of another cohort\'s recount, or with no row it replaced, differs', async () => {
        // Signals of their own chains (no piece) that only one rule set reads: 00:00:26 JST of 11-02 is in
        // R2's window of 11-01 (gapMs 29 s after its end), not R1's (23 s); 23:58:00 JST before 11-01 and
        // before 11-02 are in R2's look-back (151 s), not R1's (101 s).
        const { pool, r1, r2, catalog, k2 } = await seeded(({ pool: p }) => {
            chain(p, A, 97, at('2026-11-01T15:00:26Z'), 1);
            chain(p, A, 98, at('2026-10-31T14:58:00Z'), 1);
            chain(p, A, 99, at('2026-11-01T14:58:00Z'), 1);
        });
        const w = evidenceWindow(jstDayRange('2026-11-01').start, jstDayRange('2026-11-01').end, RULES_2.counting);
        const evidence = signalsOfA(pool).filter((s) => s.at >= w.from && s.at <= w.to);
        assert.equal(evidence.length, rowOf(pool, '2026-11-01').signals + 2, 'R2 reads more evidence for 11-01 than R1 did, before and after it');
        // A recount of 11-01 with R2: 11-01 under R2 (10 pairs of 5 s, R2's evidence), 11-02 again with its own R1 and the new carry.
        const rows = (/** @type {Array<[string, string, number, number, number]>} */ ([['2026-11-01', r2.id, 50, 0, 50], ['2026-11-02', r1.id, 70, 0, 70]])).map(([day, ruleSetId, counted, over, unit]) => {
            const close = rowOf(pool, day);
            const [signals, evidenceSha256] = ruleSetId === r2.id ? [evidence.length, evidenceDigest(evidence)] : [close.signals, close.evidence_sha256];
            return { userId: A, day, ruleSetId, catalogId: catalog.id, countedMs: counted * S, overCapMs: over * S, signals, evidenceSha256, units: /** @type {Array<[string, number, number]>} */ ([[U1, unit * S, over * S]]) };
        });
        const recount = pool.addRecount({ cohortId: COHORT, fromDay: '2026-11-01', toDay: '2026-11-01', ruleSetId: r2.id, rows });
        assert.deepEqual(await differences(pool), [], 'the recount rows check');
        // The same rows naming versions the recount did not use.
        rowOf(pool, '2026-11-02').rule_set_id = r2.id;
        assert.deepEqual((await differences(pool)).filter(([, what]) => what === 'recount'), [['2026-11-02', 'recount']], 'outside its days: the replaced row\'s versions');
        rowOf(pool, '2026-11-02').rule_set_id = r1.id;
        rowOf(pool, '2026-11-01').rule_set_id = r1.id;
        assert.deepEqual((await differences(pool)).filter(([, what]) => what === 'recount'), [['2026-11-01', 'recount']], 'inside its days: the override');
        rowOf(pool, '2026-11-01').rule_set_id = r2.id;
        // Its record of another cohort (023's composite foreign key refuses it; the check says so too).
        pool.state.recounts.find((r) => r.id === recount).cohort_id = OTHER_COHORT;
        assert.deepEqual(await differences(pool), [['2026-11-01', 'recount'], ['2026-11-02', 'recount']]);
        pool.state.recounts.find((r) => r.id === recount).cohort_id = COHORT;
        // A second recount of 11-01 that overrides only the unit list: its rules come from the row it
        // replaced (the first recount's, R2), not from the close row (R1).
        const first = rowOf(pool, '2026-11-01');
        const second = pool.addRecount({ cohortId: COHORT, fromDay: '2026-11-01', toDay: '2026-11-01', catalogId: k2.id,
            rows: [{ userId: A, day: '2026-11-01', ruleSetId: r2.id, catalogId: k2.id, countedMs: 50 * S, overCapMs: 0, signals: first.signals, evidenceSha256: first.evidence_sha256, units: [[U1, 50 * S, 0]] }] });
        assert.deepEqual(await differences(pool), [], 'a second recount of the same day');
        rowOf(pool, '2026-11-01').rule_set_id = r1.id;
        assert.deepEqual((await differences(pool)).filter(([, what]) => what === 'recount'), [['2026-11-01', 'recount']], 'the close row\'s rules');
        rowOf(pool, '2026-11-01').rule_set_id = r2.id;
        rowOf(pool, '2026-11-01').catalog_version_id = catalog.id;
        assert.deepEqual(await differences(pool), [['2026-11-01', 'recount']], 'not its override\'s unit list');
        rowOf(pool, '2026-11-01').catalog_version_id = k2.id;
        // Its unit list does not parse with this code (a version it does not have): never counted with another.
        pool.state.catalogs.find((k) => k.id === k2.id).manifest.schema = 'risepath.training-course/v9';
        assert.deepEqual((await check(pool, A)).learners[0].differences.map((d) => [d.day, d.what, d.detail.cause]), [['2026-11-01', 'version', 'unparsed']]);
        pool.state.catalogs.find((k) => k.id === k2.id).manifest.schema = COURSE.schema;
        // A recount row with no row before it on its day.
        pool.state.days = pool.state.days.filter((d) => !(d.user_id === A && d.day === '2026-11-01' && d.recompute_id !== second));
        assert.deepEqual(await differences(pool), [['2026-11-01', 'recount']]);
    });

    it('a stored setting that no longer parses stops the check (invalid_setting)', async () => {
        const { pool } = await seeded();
        pool.state.rules[0].params.counting.gapMs = 1;
        assert.equal((await check(pool)).error_type, 'invalid_setting');
    });

    it('a learner without a closed day: ok with no day', async () => {
        const { pool } = await seeded();
        pool.state.days = pool.state.days.filter((d) => d.user_id !== B);
        assert.deepEqual((await check(pool, B)).learners, [{ userId: B, days: 0, differences: [] }]);
    });
});
