// Job training, the check of closed study time days (tools/core/trainingTimeCheck.js;
// doc/brushup-2026/training-plan.ja.md §4.9, D12), on the in-memory tables of
// server/tests/helpers/trainingTimePool.js. Pinned here:
// - the counting versions (shared/training/countingVersions.js): study-time/v1 is the study time
//   functions themselves; an unknown version is no version; the module imports only ./studyTime.js;
// - the check: every current row of a learner, in day order with the units carried from the stored
//   rows, against its versions, its provenance (a close row: the cohort's setting of its day; a
//   recount row: its recount's override inside the recount's days, the row it replaced for the
//   version not overridden and outside those days), its evidence (count and sha256 of its window) and
//   its values (counted, over the set time, each unit); one snapshot per learner (the snapshot BEGIN,
//   every read on its client), no lock, nothing written; a stored setting that does not parse stops it.
// The single snapshot and the migration on PostgreSQL 16 are proved by scripts/db/verify-training.mjs
// (T17, T18). Every rule value here is artificial.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COUNTING_VERSIONS, countingVersion } from '../../shared/training/countingVersions.js';
import { STUDY_TIME_ALGORITHM, countDay, evidenceWindow } from '../../shared/training/studyTime.js';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { TRAINING_TIME_SQL, closeDays, loadCatalog, loadRules } from '../../tools/core/trainingTime.js';
import { CHECK_SQL, verifyCohort } from '../../tools/core/trainingTimeCheck.js';
import { createTrainingTimePool } from './helpers/trainingTimePool.js';

const S = 1000;
const A = 'aaaaaaaa-2222-4000-8000-0000000000a1';
const B = 'aaaaaaaa-2222-4000-8000-0000000000b2';
const COHORT = 'c2200000-0000-4000-8000-000000000001';
const OTHER_COHORT = 'c2200000-0000-4000-8000-000000000002';
const SLUG = 'web-2026-11';
// Artificial rules: a pair counts up to 13 s (R1) or 5 s (R2).
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7 * S, minSpacingMs: 3 * S, maxPlaces: 3 },
    counting: { gapMs: 23 * S, creditCapMs: 13 * S, idleMs: 101 * S, requireFocus: false, overlap: 'prefer_focus_latest' },
});
const RULES_IN_2 = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 5 * S } });
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));
const U1 = 'sample-u1'; // 2 minutes
const at = (iso) => Date.parse(iso);
const chainId = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03'];

/**
 * A cohort of November 2026 with A and B as learners added on 10-31 JST, the unit list and the rules
 * R1 in effect from 11-01, R2 loaded, and 11 signals 7 s apart on sample-u1 at 10:00 JST of each day
 * of DAYS for each learner, closed (70 s a day: 70, 50 + 20 over, 0 + 70 over).
 */
async function seeded() {
    const pool = createTrainingTimePool({
        clock: at('2026-11-04T03:00:00Z'),
        stubs: [A, B],
        cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }, { id: OTHER_COHORT, slug: 'other', name: 'Other', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
        memberships: [A, B].map((user) => ({ user_id: user, cohort_id: COHORT, added_at: at('2026-10-31T01:00:00Z') })),
    });
    const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'staff-a', note: 'sample', pool }));
    const r1 = /** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'staff-a', note: 'sample', pool }));
    const r2 = /** @type {any} */ (await loadRules({ input: RULES_IN_2, loadedBy: 'staff-a', note: 'sample', pool }));
    pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: r1.id, effectiveFrom: '2026-11-01' });
    let n = 0;
    for (const user of [A, B]) {
        for (const day of DAYS) {
            n += 1;
            const from = at(`${day}T01:00:00Z`);
            for (let seq = 0; seq < 11; seq += 1) {
                pool.addSignal({ userId: user, cohortId: COHORT, unit: U1, chain: chainId(n), born: from, seq, at: from + seq * 7 * S, focus: true, input: true });
            }
        }
        await closeDays({ userId: user, cohortId: COHORT, computedBy: 'staff', pool });
    }
    return { pool, catalog, r1, r2 };
}

const check = async (pool, learner) => /** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, learner, pool }));
const differences = async (pool, learner = A) => (await check(pool, learner)).learners[0].differences.map((d) => [d.day, d.what]);
/** A's current row of a day (read each time: the pool's state is another object after a rollback). */
const rowOf = (pool, day) => pool.state.days.filter((d) => d.user_id === A && d.day === day).at(-1);

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
    it('closed days check, every learner or one; each learner in one snapshot (every read after the snapshot BEGIN, on its client), no lock, nothing written', async () => {
        const { pool } = await seeded();
        const sent0 = pool.queries.length;
        const checked = await check(pool);
        assert.equal(checked.status, 'checked');
        assert.deepEqual(checked.learners.map((l) => [l.userId, l.days, l.differences]), [[A, 3, []], [B, 3, []]], 'learners in id order');
        const sent = pool.queries.slice(sent0);
        const begins = sent.flatMap((q, i) => (q.sql === TRAINING_TIME_SQL.beginSnapshot ? [i] : []));
        assert.equal(begins.length, 2, 'one snapshot per learner');
        // Inside each snapshot: the setting, the learner's rows, units, versions and evidence, then a rollback.
        for (const i of begins) {
            const inside = sent.slice(i, sent.findIndex((q, j) => j > i && q.sql === 'ROLLBACK') + 1);
            assert.ok(inside.every((q) => q.tx), 'on the transaction\'s client');
            assert.deepEqual(inside.map((q) => q.sql), [
                TRAINING_TIME_SQL.beginSnapshot, TRAINING_SQL.lockTimeout, TRAINING_TIME_SQL.closeSettings, CHECK_SQL.learnerRows, CHECK_SQL.unitRows,
                CHECK_SQL.rulesByIds, CHECK_SQL.catalogsByIds, TRAINING_TIME_SQL.evidence, 'ROLLBACK',
            ]);
        }
        assert.ok(!sent.some((q) => [TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared, 'BEGIN', 'COMMIT'].includes(q.sql)), 'no lock, no write transaction');
        const one = await check(pool, B.toUpperCase());
        assert.deepEqual(one.learners.map((l) => l.userId), [B]);
        assert.deepEqual(await verifyCohort({ cohortSlug: 'no-such', pool }), { status: 'no_cohort' });
        assert.deepEqual(await verifyCohort({ cohortSlug: SLUG, learner: 'aaaaaaaa-2222-4000-8000-0000000000e0', pool }), { status: 'not_a_learner' });
        assert.equal((await check(pool, 'nope')).error_type, 'validation');
        assert.equal((await verifyCohort({ cohortSlug: SLUG, pool: null })).error_type, 'db_connection');
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
        assert.deepEqual(await differences(pool), [['2026-11-02', 'setting'], ['2026-11-02', 'evidence'], ['2026-11-02', 'values'], ['2026-11-03', 'version']]);
        assert.deepEqual(await differences(pool, B), [], 'B unchanged');
    });

    it('the units carried are the stored ones: a changed unit row makes its day and the later days differ (they were counted after it)', async () => {
        const { pool } = await seeded();
        const day1 = rowOf(pool, '2026-11-01');
        pool.state.unitDays.find((u) => u.day_id === day1.id).counted_ms = 10 * S;
        assert.deepEqual(await differences(pool), [['2026-11-01', 'values'], ['2026-11-02', 'values'], ['2026-11-03', 'values']]);
    });

    it('recount rows: the recount\'s override inside its days (the replaced row for the version not overridden), the replaced row\'s versions outside them; a row without its recount, of another cohort\'s recount, or with no row it replaced, differs', async () => {
        const { pool, r1, r2, catalog } = await seeded();
        // A recount of 11-01 with R2: 11-01 under R2 (10 pairs of 5 s), 11-02 again with its own R1 and the new carry.
        const rows = (/** @type {Array<[string, string, number, number, number]>} */ ([['2026-11-01', r2.id, 50, 0, 50], ['2026-11-02', r1.id, 70, 0, 70]])).map(([day, ruleSetId, counted, over, unit]) => {
            const close = rowOf(pool, day);
            return { userId: A, day, ruleSetId, catalogId: catalog.id, countedMs: counted * S, overCapMs: over * S, signals: close.signals, evidenceSha256: close.evidence_sha256, units: /** @type {Array<[string, number, number]>} */ ([[U1, unit * S, over * S]]) };
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
        // A recount row with no row before it on its day.
        pool.state.days = pool.state.days.filter((d) => !(d.user_id === A && d.day === '2026-11-01' && d.kind === 'close'));
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
