// Job training, recounts and checks of study time (tools/core/trainingTimeRecount.js;
// doc/brushup-2026/training-plan.ja.md §4.9, D12), on the in-memory tables of
// server/tests/helpers/trainingTimePool.js. Pinned here:
// - the counting versions (shared/training/countingVersions.js): study-time/v1 counts a day as the
//   close does; an unknown version is no version;
// - the check: every current row of a learner, in day order with the stored carry, against its
//   versions, its provenance (a close row: the setting of its day; a recount row: its recount's
//   override inside its days, else the row it replaced), its evidence and its values; one changed row
//   does not make the later ones look changed; one snapshot per learner, no lock;
// - the recount: other versions for from..to, every later closed day with its own row's versions and
//   the new carry, only the days whose versions or values change; a later recount never undoes an
//   earlier one (a day's own versions are its current row's); the refusals (not closed, unverified,
//   not final under the override's gapMs (the day only), another course, outside the dates, unknown
//   versions, the input); the plan's canonical form and its sha256, which binds who and why; the dry
//   run in one snapshot with no lock and nothing written; the write: every live learner's locks in id
//   order, the plan built again under them, written only with the confirmed sha256 (the record, then
//   each learner's rows in day order and their unit rows), refused when anything changed meanwhile
//   (another recount, a deletion during the lock wait);
// - the clock guard widened by a recount of the last closed day with a wider gapMs;
// - the staff reads (a cohort's recounts, a learner's rows).
// The behaviour on PostgreSQL 16 (the migration, locks, the deletion race) is proved by
// scripts/db/verify-training.mjs (T17). Every rule value here is artificial.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { COUNTING_VERSIONS, countingVersion } from '../../shared/training/countingVersions.js';
import { STUDY_TIME_ALGORITHM, countDay, evidenceWindow } from '../../shared/training/studyTime.js';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { TRAINING_TIME_SQL, closeDays, learnerDays, loadCatalog, loadRules, recordSignal } from '../../tools/core/trainingTime.js';
import { verifyCohort } from '../../tools/core/trainingTimeCheck.js';
import {
    RECOUNT_PLAN,
    RECOUNT_SQL,
    cohortRecounts,
    learnerHistory,
    planRecount,
    recountCohort,
} from '../../tools/core/trainingTimeRecount.js';
import { createTrainingTimePool } from './helpers/trainingTimePool.js';

const S = 1000;
const A = 'aaaaaaaa-2222-4000-8000-0000000000a1';
const B = 'aaaaaaaa-2222-4000-8000-0000000000b2';
const COHORT = 'c2200000-0000-4000-8000-000000000001';
const SLUG = 'web-2026-11';
// Artificial rules: a pair counts up to 13 s (R1) or 5 s (R2); WIDE has a 6-hour gap.
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7 * S, minSpacingMs: 3 * S, maxPlaces: 3 },
    counting: { gapMs: 23 * S, creditCapMs: 13 * S, idleMs: 101 * S, requireFocus: false, overlap: 'prefer_focus_latest' },
});
const RULES_IN_2 = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 5 * S } });
const RULES_WIDE = Object.freeze({ ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 6 * 60 * 60 * S } });
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));
// The same course with sample-u1 at 3 minutes instead of 2; and another course.
const COURSE_3 = { ...COURSE, units: [{ ...COURSE.units[0], setMinutes: 3 }, COURSE.units[1]] };
const OTHER_COURSE = { ...COURSE, courseKey: 'other-course' };
const U1 = 'sample-u1'; // 2 minutes
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const at = (iso) => Date.parse(iso);
const chainId = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03'];

/**
 * A cohort of November 2026 with A (and B when asked) as learners added on 10-31 JST, the unit list
 * and the rules R1 in effect from 11-01, R2 and WIDE loaded, and 11 signals 7 s apart on sample-u1
 * at 10:00 JST of each day of DAYS for each learner (70 s a day: 70, 50 + 20 over, 0 + 70 over).
 */
async function seeded({ clock = at('2026-11-04T03:00:00Z'), learners = [A], study = learners } = {}) {
    const pool = createTrainingTimePool({
        clock,
        stubs: [A, B],
        cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
        memberships: learners.map((user) => ({ user_id: user, cohort_id: COHORT, added_at: at('2026-10-31T01:00:00Z') })),
    });
    const load = (input) => loadRules({ input, loadedBy: 'staff-a', note: 'sample', pool });
    const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'staff-a', note: 'sample', pool }));
    const r1 = /** @type {any} */ (await load(RULES_IN));
    const r2 = /** @type {any} */ (await load(RULES_IN_2));
    const wide = /** @type {any} */ (await load(RULES_WIDE));
    pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: r1.id, effectiveFrom: '2026-11-01' });
    let n = 0;
    for (const user of study) {
        for (const day of DAYS) {
            n += 1;
            const from = at(`${day}T01:00:00Z`);
            for (let seq = 0; seq < 11; seq += 1) {
                pool.addSignal({ userId: user, cohortId: COHORT, unit: U1, chain: chainId(n), born: from, seq, at: from + seq * 7 * S, focus: true, input: true });
            }
        }
    }
    return { pool, catalog, r1, r2, wide };
}

const close = (pool, userId = A) => closeDays({ userId, cohortId: COHORT, computedBy: 'staff', pool });
const values = async (pool, userId = A) => (/** @type {any} */ (await learnerDays({ userId, cohortId: COHORT, pool }))).days.map((d) => [d.day, d.kind, d.countedMs / S, d.overCapMs / S]);
const recount = (pool, over = {}) => ({ cohortSlug: SLUG, fromDay: '2026-11-01', toDay: '2026-11-01', recomputedBy: 'staff-a', reason: 'the provider confirmed new rules', pool, ...over });
const changedOf = (plan) => plan.learners.map((l) => [l.userId, l.days.map((d) => [d.day, d.before.countedMs / S, d.before.overCapMs / S, d.after.countedMs / S, d.after.overCapMs / S])]);

describe('shared/training/countingVersions.js', () => {
    it('study-time/v1 is the study time functions themselves; anything else is no version', () => {
        assert.deepEqual(Object.keys(COUNTING_VERSIONS), [STUDY_TIME_ALGORITHM]);
        assert.equal(countingVersion(STUDY_TIME_ALGORITHM)?.countDay, countDay);
        assert.equal(countingVersion(STUDY_TIME_ALGORITHM)?.evidenceWindow, evidenceWindow);
        for (const name of ['study-time/v2', 'study-time/v0', '', null, undefined, 'toString', '__proto__', 1]) assert.equal(countingVersion(name), null, String(name));
        assert.ok(Object.isFrozen(COUNTING_VERSIONS) && Object.isFrozen(COUNTING_VERSIONS[STUDY_TIME_ALGORITHM]));
    });

    it('imports only ./studyTime.js and reads no clock', () => {
        const code = fs.readFileSync(new URL('../../shared/training/countingVersions.js', import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.deepEqual([...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['./studyTime.js']);
        assert.doesNotMatch(code, /Date\.now|Math\.random|new Date\(\)/);
    });
});

describe('tools/core/trainingTimeRecount.js: the check', () => {
    it('closed days check: each current row against its versions, its setting, its evidence and its values; one snapshot per learner, no lock, nothing written', async () => {
        const { pool } = await seeded({ learners: [A, B] });
        await close(pool, A);
        await close(pool, B);
        assert.deepEqual(await values(pool, A), [['2026-11-01', 'close', 70, 0], ['2026-11-02', 'close', 50, 20], ['2026-11-03', 'close', 0, 70]]);
        const before = pool.queries.length;
        const checked = /** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }));
        assert.equal(checked.status, 'checked');
        assert.deepEqual(checked.learners.map((l) => [l.userId, l.days, l.differences]), [[A, 3, []], [B, 3, []]]);
        const sent = pool.queries.slice(before).map((q) => q.sql);
        assert.equal(sent.filter((q) => q === TRAINING_TIME_SQL.beginSnapshot).length, 2, 'one snapshot per learner');
        assert.ok(!sent.includes('BEGIN') && !sent.includes('COMMIT'));
        assert.ok(!sent.some((q) => [TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared].includes(q)), 'no lock');
        assert.ok(!sent.some((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q)));
        const one = /** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, learner: B.toUpperCase(), pool }));
        assert.deepEqual(one.learners.map((l) => l.userId), [B]);
        assert.deepEqual(await verifyCohort({ cohortSlug: 'no-such', pool }), { status: 'no_cohort' });
        assert.deepEqual(await verifyCohort({ cohortSlug: SLUG, learner: 'aaaaaaaa-2222-4000-8000-0000000000e0', pool }), { status: 'not_a_learner' });
        assert.equal((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, learner: 'nope', pool }))).error_type, 'validation');
    });

    it('differences: a changed value (that day only: the next day carries the stored value), evidence added to a closed window, a version this code does not have, a close row with another setting\'s versions', async () => {
        const { pool, r2 } = await seeded();
        await close(pool);
        // pool.state is another object after each rollback (the snapshot): read the rows each time.
        pool.state.days[0].counted_ms = 69 * S; // 11-01 (the unit rows still say 70 s)
        pool.addSignal({ userId: A, cohortId: COHORT, unit: U1, chain: chainId(90), born: at('2026-11-02T05:00:00Z'), seq: 0, at: at('2026-11-02T05:00:00Z'), focus: true, input: true });
        const checked = /** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }));
        assert.deepEqual(checked.learners[0].differences.map((d) => [d.day, d.what]), [['2026-11-01', 'values'], ['2026-11-02', 'evidence']]);
        assert.deepEqual(checked.learners[0].differences[0].detail.stored.countedMs, 69 * S);
        assert.deepEqual(checked.learners[0].differences[1].detail, { stored: 11, found: 12 });
        pool.state.days[0].counted_ms = 70 * S;
        pool.state.days[2].algorithm = 'study-time/v9';
        pool.state.days[1].rule_set_id = r2.id;
        const again = /** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }));
        // 11-02 now names R2: not the setting of its day, and R2 gives other values than the row's.
        assert.deepEqual(again.learners[0].differences.map((d) => [d.day, d.what]), [['2026-11-02', 'setting'], ['2026-11-02', 'evidence'], ['2026-11-02', 'values'], ['2026-11-03', 'version']]);
    });

    it('a stored setting that no longer parses stops the check (invalid_setting)', async () => {
        const { pool } = await seeded();
        await close(pool);
        pool.state.rules[0].params.counting.gapMs = 1;
        assert.equal((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }))).error_type, 'invalid_setting');
    });
});

describe('tools/core/trainingTimeRecount.js: the recount', () => {
    it('a dry run: the override for from..to, every later closed day with its own versions and the new carry, only the changed days; one snapshot, no lock, nothing written; the plan\'s canonical form and sha256', async () => {
        const { pool, r1, r2, catalog } = await seeded();
        await close(pool);
        const before = structuredClone(pool.state.days);
        const sent0 = pool.queries.length;
        const plan = /** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })));
        assert.equal(plan.status, 'plan');
        // 11-01 with R2: 10 pairs of 5 s; 11-02 with R1 and 50 s carried: 70 s fit under the set time; 11-03 unchanged.
        assert.deepEqual(changedOf(plan), [[A, [['2026-11-01', 70, 0, 50, 0], ['2026-11-02', 50, 20, 70, 0]]]]);
        assert.deepEqual(plan.learners[0].days.map((d) => [d.before.rules, d.after.rules, d.after.catalog]), [[r1.sha256, r2.sha256, catalog.sha256], [r1.sha256, r1.sha256, catalog.sha256]]);
        assert.equal(plan.plan.plan, RECOUNT_PLAN);
        assert.deepEqual([plan.plan.cohort, plan.plan.from, plan.plan.to, plan.plan.rules, plan.plan.catalog, plan.plan.by, plan.plan.reason],
            [COHORT, '2026-11-01', '2026-11-01', r2.sha256, null, 'staff-a', 'the provider confirmed new rules']);
        assert.equal(plan.sha256, sha256(canonicalJson(plan.plan)));
        assert.equal(JSON.stringify(plan.plan), JSON.stringify(JSON.parse(JSON.stringify(plan.plan))), 'plain data only: no Map, Date or BigInt');
        assert.deepEqual(plan.plan.learners[0].days[1].after.units, [[U1, 70 * S, 0]], 'units as [key, counted, over]');
        const sent = pool.queries.slice(sent0).map((q) => q.sql);
        assert.deepEqual([sent.filter((q) => q === TRAINING_TIME_SQL.beginSnapshot).length, sent.at(-1)], [1, 'ROLLBACK']);
        assert.ok(!sent.some((q) => [TRAINING_SQL.lock, TRAINING_SQL.learnerLock].includes(q)) && !sent.some((q) => /^\s*INSERT/i.test(q)));
        assert.deepEqual(pool.state.days, before, 'nothing written');
        assert.deepEqual(pool.state.recounts, []);
        // The same input again: the same plan. Who or why changed: another sha256 (it binds them).
        assert.equal((/** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })))).sha256, plan.sha256);
        assert.notEqual((/** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256, recomputedBy: 'staff-b' })))).sha256, plan.sha256);
        assert.notEqual((/** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256, reason: 'another' })))).sha256, plan.sha256);
    });

    it('the write: the confirmed sha256 appends the recount\'s record and its rows (old rows kept, the new current values check); every live learner\'s locks first, in id order, then the plan again', async () => {
        const { pool, r2 } = await seeded({ learners: [B, A] });
        await close(pool, A);
        await close(pool, B);
        const plan = /** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })));
        assert.deepEqual(plan.learners.map((l) => l.userId), [A, B], 'learners in id order');
        const sent0 = pool.tx().length;
        const written = /** @type {any} */ (await recountCohort(recount(pool, { rulesSha256: r2.sha256, expect: plan.sha256 })));
        assert.deepEqual([written.status, written.learners, written.days, written.sha256], ['recounted', 2, 4, plan.sha256]);
        const tx = pool.tx().slice(sent0);
        assert.deepEqual(tx.slice(0, 7), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_TIME_SQL.learners, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_SQL.lock, TRAINING_SQL.learnerLock]);
        assert.deepEqual(pool.queries.filter((q) => q.sql === TRAINING_SQL.learnerLock).slice(-2).map((q) => q.params[0]), [A, B]);
        assert.ok(tx.indexOf(RECOUNT_SQL.insertRecount) > tx.lastIndexOf(TRAINING_TIME_SQL.evidence), 'the plan is built again under the locks');
        assert.equal(tx.at(-1), 'COMMIT');
        assert.deepEqual(pool.state.recounts.map((r) => [r.cohort_id, r.from_day, r.to_day, r.rule_set_id, r.catalog_version_id, r.plan_sha256, r.recomputed_by, r.reason]),
            [[COHORT, '2026-11-01', '2026-11-01', r2.id, null, plan.sha256, 'staff-a', 'the provider confirmed new rules']]);
        assert.deepEqual(Object.keys(pool.state.recounts[0]).filter((k) => /user|counted|learners|days/.test(k)), [], 'no learner and no learner value in the record');
        for (const user of [A, B]) assert.deepEqual(await values(pool, user), [['2026-11-01', 'recompute', 50, 0], ['2026-11-02', 'recompute', 70, 0], ['2026-11-03', 'close', 0, 70]]);
        const rows = pool.state.days.filter((d) => d.user_id === A);
        assert.deepEqual(rows.map((d) => [d.day, d.kind, d.recompute_id]), [
            ['2026-11-01', 'close', null], ['2026-11-02', 'close', null], ['2026-11-03', 'close', null],
            ['2026-11-01', 'recompute', pool.state.recounts[0].id], ['2026-11-02', 'recompute', pool.state.recounts[0].id],
        ], 'the old rows stay; the recount rows name it, in day order');
        assert.deepEqual(pool.state.unitDays.filter((u) => u.day_id === rows[4].id).map((u) => [u.unit_key, u.counted_ms, u.over_cap_ms]), [[U1, 70 * S, 0]]);
        const checked = /** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }));
        assert.deepEqual(checked.learners.map((l) => l.differences), [[], []], 'the recount rows check (their versions: the override, and the replaced row\'s)');
        // The same plan again: nothing is left to change.
        const again = /** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })));
        assert.deepEqual(again.learners, []);
        assert.deepEqual(await recountCohort(recount(pool, { rulesSha256: r2.sha256, expect: again.sha256 })), { status: 'unchanged', sha256: again.sha256 });
    });

    it('another sha256, or a plan that changed since the dry run (another recount, a deletion during the lock wait): refused, nothing written', async () => {
        const { pool, r2, wide } = await seeded({ learners: [A, B] });
        await close(pool, A);
        await close(pool, B);
        const plan = /** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })));
        assert.deepEqual(await recountCohort(recount(pool, { rulesSha256: r2.sha256, expect: 'f'.repeat(64) })), { status: 'plan_changed', sha256: plan.sha256 });
        assert.deepEqual(await recountCohort(recount(pool, { rulesSha256: r2.sha256, reason: 'not the one reviewed', expect: plan.sha256 })).then((r) => /** @type {any} */ (r).status), 'plan_changed');
        // Another recount of 11-02 first: the rows the plan replaces are not the current ones any more.
        const other = /** @type {any} */ (await planRecount(recount(pool, { fromDay: '2026-11-02', toDay: '2026-11-02', rulesSha256: wide.sha256 })));
        assert.equal((/** @type {any} */ (await recountCohort(recount(pool, { fromDay: '2026-11-02', toDay: '2026-11-02', rulesSha256: wide.sha256, expect: other.sha256 })))).status, 'recounted');
        const days = pool.state.days.length;
        assert.equal((/** @type {any} */ (await recountCohort(recount(pool, { rulesSha256: r2.sha256, expect: plan.sha256 })))).status, 'plan_changed');
        assert.equal(pool.state.days.length, days);
        // A deletion of B commits while the write waits for B's lock: B is not in the plan built under the locks.
        const fresh = /** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })));
        let done = false;
        pool.before(TRAINING_SQL.learnerLock, () => {
            if (done) return;
            done = true;
            pool.deleteAccount(B, at('2026-11-04T03:00:00Z'));
        });
        const refused = /** @type {any} */ (await recountCohort(recount(pool, { rulesSha256: r2.sha256, expect: fresh.sha256 })));
        assert.equal(refused.status, 'plan_changed');
        assert.equal(pool.state.recounts.length, 1, 'only the first recount');
    });

    it('a later recount never undoes an earlier one: a day\'s own versions are its current row\'s, inside the range for the version not overridden and on every later day', async () => {
        const { pool, r2 } = await seeded();
        await close(pool);
        const k3 = /** @type {any} */ (await loadCatalog({ input: COURSE_3, loadedBy: 'staff-a', note: 'u1 three minutes', pool }));
        // #1: R2 on 11-02 only (11-02: 50 s carried, R2 gives 50 s under the set time).
        const p1 = /** @type {any} */ (await planRecount(recount(pool, { fromDay: '2026-11-02', toDay: '2026-11-02', rulesSha256: r2.sha256 })));
        assert.deepEqual(changedOf(p1), [[A, [['2026-11-02', 50, 20, 50, 0]]]]);
        await recountCohort(recount(pool, { fromDay: '2026-11-02', toDay: '2026-11-02', rulesSha256: r2.sha256, expect: p1.sha256 }));
        // #2: the 3-minute unit list on 11-01 only. 11-01 keeps its numbers (a version change only);
        // 11-02 is counted with its own R2 (not the setting's R1) and the 2-minute list of its row.
        const p2 = /** @type {any} */ (await planRecount(recount(pool, { catalogSha256: k3.sha256 })));
        assert.deepEqual(changedOf(p2), [[A, [['2026-11-01', 70, 0, 70, 0]]]]);
        assert.deepEqual(p2.learners[0].days[0].after.catalog, k3.sha256);
        await recountCohort(recount(pool, { catalogSha256: k3.sha256, expect: p2.sha256 }));
        assert.deepEqual(await values(pool), [['2026-11-01', 'recompute', 70, 0], ['2026-11-02', 'recompute', 50, 0], ['2026-11-03', 'close', 0, 70]]);
        assert.deepEqual((/** @type {any} */ (await verifyCohort({ cohortSlug: SLUG, pool }))).learners[0].differences, []);
    });

    it('refusals before anything: days not all closed (a learner without the last day\'s close), a row that does not check, not final under the override\'s gapMs (the day only), another course, outside the dates, unknown versions', async () => {
        const { pool, r2, wide } = await seeded({ learners: [A, B] });
        await close(pool, A);
        assert.deepEqual(await planRecount(recount(pool, { rulesSha256: r2.sha256 })), { status: 'not_closed', learners: [B] });
        await close(pool, B);
        pool.state.days[0].counted_ms = 1;
        const unverified = /** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })));
        assert.equal(unverified.status, 'unverified');
        assert.deepEqual(unverified.learners.map((l) => [l.userId, l.differences.map((d) => [d.day, d.what])]), [[A, [['2026-11-01', 'values']]]]);
        pool.state.days[0].counted_ms = 70 * S;
        assert.equal((/** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })))).status, 'plan');
        // 01:00 JST on 11-04: 11-03 is final under R1's 23 s gap (closed), not under WIDE's 6 hours.
        pool.setClock(at('2026-11-03T16:00:00Z'));
        assert.deepEqual(await planRecount(recount(pool, { toDay: '2026-11-03', rulesSha256: wide.sha256 })), { status: 'not_final', day: '2026-11-03' });
        pool.setClock(at('2026-11-04T03:00:00Z'));
        const other = /** @type {any} */ (await loadCatalog({ input: OTHER_COURSE, loadedBy: 'staff-a', note: 'other', pool }));
        assert.deepEqual(await planRecount(recount(pool, { catalogSha256: other.sha256 })), { status: 'course_differs', userId: A, day: '2026-11-01' });
        assert.deepEqual(await planRecount(recount(pool, { fromDay: '2026-10-31', rulesSha256: r2.sha256 })), { status: 'outside_dates' });
        assert.deepEqual(await planRecount(recount(pool, { rulesSha256: 'e'.repeat(64) })), { status: 'no_rules' });
        assert.deepEqual(await planRecount(recount(pool, { catalogSha256: 'e'.repeat(64) })), { status: 'no_catalog' });
        assert.deepEqual(await planRecount(recount(pool, { cohortSlug: 'no-such', rulesSha256: r2.sha256 })), { status: 'no_cohort' });
        pool.state.days[1].algorithm = 'study-time/v9';
        assert.equal((/** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })))).status, 'unverified', 'a version this code does not have does not check');
    });

    it('the input is checked before any statement: at least one override, sha256 names, the days, who and why', async () => {
        const { pool, r2 } = await seeded();
        const sent = pool.queries.length;
        for (const over of [
            {},
            { rulesSha256: 'ABC' },
            { catalogSha256: 'g'.repeat(64) },
            { rulesSha256: r2.sha256, fromDay: '2026-11-02', toDay: '2026-11-01' },
            { rulesSha256: r2.sha256, toDay: '2026-02-30' },
            { rulesSha256: r2.sha256, recomputedBy: ' ' },
            { rulesSha256: r2.sha256, reason: 'x'.repeat(501) },
        ]) {
            assert.equal((/** @type {any} */ (await planRecount(recount(pool, over)))).error_type, 'validation', JSON.stringify(over));
        }
        assert.equal((/** @type {any} */ (await recountCohort(recount(pool, { rulesSha256: r2.sha256, expect: 'nope' })))).error_type, 'validation');
        assert.equal(pool.queries.length, sent);
    });
});

describe('the clock guard and the staff reads', () => {
    it('a recount of the last closed day with a wider gapMs widens the guard: a signal whose clock went back inside that window is not stored', async () => {
        const { pool, wide } = await seeded();
        await close(pool);
        const plan = /** @type {any} */ (await planRecount(recount(pool, { fromDay: '2026-11-03', toDay: '2026-11-03', rulesSha256: wide.sha256 })));
        await recountCohort(recount(pool, { fromDay: '2026-11-03', toDay: '2026-11-03', rulesSha256: wide.sha256, expect: plan.sha256 }));
        // The database clock back at 11-04 05:00 JST: past 11-03's end + 23 s, inside its end + 6 hours.
        pool.setClock(at('2026-11-03T20:00:00Z'));
        const signal = { unitKey: U1, chainId: chainId(99), seq: 0, stop: false, focus: true, input: true };
        const sent = /** @type {any} */ (await recordSignal({ userId: A, cohortId: COHORT, signal, pool }));
        assert.equal(sent.status, 'clock_behind');
        // A minute after 11-03's end + 6 hours: stored.
        pool.setClock(at('2026-11-03T21:01:00Z'));
        assert.equal((/** @type {any} */ (await recordSignal({ userId: A, cohortId: COHORT, signal, pool }))).status, 'accepted');
    });

    it('a cohort\'s recounts (who, why, when, the days, the versions and the plan by sha256) and a learner\'s rows (the earlier ones and the recount that wrote each)', async () => {
        const { pool, r2 } = await seeded();
        await close(pool);
        const plan = /** @type {any} */ (await planRecount(recount(pool, { rulesSha256: r2.sha256 })));
        await recountCohort(recount(pool, { rulesSha256: r2.sha256, expect: plan.sha256 }));
        const list = /** @type {any} */ (await cohortRecounts({ cohortId: COHORT, pool }));
        assert.deepEqual(list.map((r) => [r.recomputedBy, r.reason, r.fromDay, r.toDay, r.rulesSha256, r.catalogSha256, r.planSha256]),
            [['staff-a', 'the provider confirmed new rules', '2026-11-01', '2026-11-01', r2.sha256, null, plan.sha256]]);
        assert.equal(list[0].recomputedAt, new Date(at('2026-11-04T03:00:00Z')).toISOString());
        const history = /** @type {any} */ (await learnerHistory({ userId: A, cohortId: COHORT, pool }));
        assert.deepEqual(history.map((r) => [r.day, r.kind, r.countedMs / S, r.recomputeId]), [
            ['2026-11-01', 'close', 70, null], ['2026-11-01', 'recompute', 50, list[0].id],
            ['2026-11-02', 'close', 50, null], ['2026-11-02', 'recompute', 70, list[0].id],
            ['2026-11-03', 'close', 0, null],
        ]);
        assert.equal((/** @type {any} */ (await learnerHistory({ userId: 'nope', cohortId: COHORT, pool }))).error_type, 'validation');
    });
});
