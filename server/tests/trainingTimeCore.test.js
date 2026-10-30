// Study time records (tools/core/trainingTime.js; migration 022) on an in-memory database that
// answers the module's own statements (server/tests/helpers/trainingTimePool.js). PostgreSQL 16
// runs the same code in scripts/db/verify-training.mjs (CI's Database checks). Pinned here:
// - loading a unit list or rules: one immutable version per content (sha256 of the canonical JSON),
//   errors that name fields and never values, the request limit of the training API;
// - a cohort's settings: refused before today, after the last day, today once one is in effect,
//   another course once there is evidence; append only;
// - closing: under the account lock and then the learner lock (each its own statement), only while
//   the stub exists, from the first day not closed to the last final day (its end + gapMs passed,
//   strictly), zero days too, each day with its own setting, the unit caps carried from the days
//   before, and the same numbers as the pure function (shared/training/studyTime.js).
// The values are artificial, not the school's (training-plan D9).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { manifestCanonical, setMsOf } from '../../shared/training/courseManifest.js';
import { cohortRange, countDays, evidenceWindow, jstDayRange } from '../../shared/training/studyTime.js';
import { parseTimeRules } from '../../shared/training/timeRules.js';
import { TRAINING_SQL } from '../../tools/core/training.js';
import {
    SIGNAL_FLAGS,
    TRAINING_TIME_SQL,
    closeDays,
    closeRange,
    evidenceDigest,
    flagsOf,
    loadCatalog,
    loadRules,
    setCohortTime,
    settingOf,
    signalOf,
} from '../../tools/core/trainingTime.js';
import { createTrainingTimePool } from './helpers/trainingTimePool.js';

const S = 1000;
const A = 'aaaaaaaa-2222-4000-8000-0000000000a1';
const B = 'aaaaaaaa-2222-4000-8000-0000000000b2';
const NOBODY = 'aaaaaaaa-2222-4000-8000-0000000000e0';
const COHORT = 'c2200000-0000-4000-8000-000000000001';
const SLUG = 'web-2026-11';
// Artificial rules: 3 pages at one signal per 7 s use 26 of the 30 requests a minute they may.
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7 * S, minSpacingMs: 3 * S, maxPlaces: 3 },
    counting: { gapMs: 23 * S, creditCapMs: 13 * S, idleMs: 101 * S, requireFocus: false, overlap: 'prefer_focus_latest' },
});
const RULES = /** @type {any} */ (parseTimeRules(RULES_IN)).rules;
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));
const U1 = 'sample-u1'; // 2 minutes
const U2 = 'sample-u2'; // 30 minutes
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const at = (iso) => Date.parse(iso);
const chainId = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A cohort of November 2026 with A as a learner (added 10-31 JST), a loaded catalog and rules, in effect from 11-01. */
async function seeded({ clock = at('2026-11-04T03:00:00Z'), startsOn = '2026-11-01', endsOn = '2026-11-30', rulesIn = RULES_IN } = {}) {
    const pool = createTrainingTimePool({
        clock,
        stubs: [A, B],
        cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: startsOn, ends_on: endsOn }],
        memberships: [{ user_id: A, cohort_id: COHORT, added_at: at('2026-10-31T01:00:00Z') }],
    });
    const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'staff-a', note: 'sample', pool }));
    const rules = /** @type {any} */ (await loadRules({ input: rulesIn, loadedBy: 'staff-a', note: 'sample', pool }));
    pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom: '2026-11-01' });
    return { pool, catalog, rules };
}

/**
 * One page's chain: `n` signals `every` ms apart from `from`, each with input and focus (present),
 * stored in the pool; returns them as the counting reads them.
 */
function chain(pool, { userId = A, id, unit, from, n, every = 7 * S, input = true, focus = true }) {
    const out = [];
    for (let seq = 0; seq < n; seq += 1) {
        const g = { userId, cohortId: COHORT, unit, chain: id, born: from, seq, at: from + seq * every, stop: false, focus, input };
        pool.addSignal(g);
        out.push({ chain: id, seq, unit, born: from, at: g.at, stop: false, focus, input });
    }
    return out;
}

const close = (pool, userId = A) => closeDays({ userId, cohortId: COHORT, computedBy: 'staff', pool });

describe('tools/core/trainingTime.js: loading a unit list and rules', () => {
    it('a unit list: one version per content (sha256 of its canonical JSON), the same content in another key order is that version', async () => {
        const pool = createTrainingTimePool();
        const first = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: ' staff-a ', note: 'sample', pool }));
        assert.equal(first.status, 'loaded');
        assert.equal(first.sha256, sha256(manifestCanonical(COURSE)));
        assert.deepEqual([first.courseKey, first.units], ['sample-course', 2]);
        const reordered = JSON.parse(JSON.stringify({ units: COURSE.units, title: COURSE.title, courseKey: COURSE.courseKey, schema: COURSE.schema }));
        const again = /** @type {any} */ (await loadCatalog({ input: reordered, loadedBy: 'staff-b', note: 'again', pool }));
        assert.deepEqual([again.status, again.id, again.sha256], ['exists', first.id, first.sha256]);
        assert.equal(pool.state.catalogs.length, 1);
        assert.equal(pool.state.catalogs[0].loaded_by, 'staff-a', 'trimmed; the first loader is kept');
        assert.deepEqual(pool.state.catalogs[0].manifest, JSON.parse(manifestCanonical(COURSE)));
    });

    it('rules: one version per content; the stored params are the parsed rules; the result carries no value', async () => {
        const pool = createTrainingTimePool();
        const first = /** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'staff-a', note: 'sample', pool }));
        assert.equal(first.status, 'loaded');
        assert.equal(first.sha256, sha256(canonicalJson(RULES)));
        assert.equal(first.algorithm, 'study-time/v1');
        assert.deepEqual(Object.keys(first).sort(), ['algorithm', 'id', 'sha256', 'status']);
        assert.deepEqual(pool.state.rules[0].params, RULES);
        const again = /** @type {any} */ (await loadRules({ input: JSON.parse(JSON.stringify(RULES_IN)), loadedBy: 'x', note: 'y', pool }));
        assert.deepEqual([again.status, again.id], ['exists', first.id]);
    });

    it('invalid files: refused before any statement, errors name fields only (never a value); the API request limit applies to rules', async () => {
        const pool = createTrainingTimePool();
        const course = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: [{ ...COURSE.units[0], setMinutes: 6001 }] }, loadedBy: 'a', note: 'b', pool }));
        assert.deepEqual(course, { status: 'invalid', errors: ['units[0].setMinutes'] });
        const secret = { ...RULES_IN, counting: { ...RULES_IN.counting, idleMs: 98_765.5 } };
        const rules = /** @type {any} */ (await loadRules({ input: secret, loadedBy: 'a', note: 'b', pool }));
        assert.deepEqual(rules, { status: 'invalid', errors: ['counting.idleMs'] });
        assert.doesNotMatch(JSON.stringify(rules), /98765|98_765/);
        // 7 pages at one signal per 7 s would use 60 requests a minute, all of the API's limit.
        const busy = /** @type {any} */ (await loadRules({ input: { ...RULES_IN, collection: { ...RULES_IN.collection, maxPlaces: 7 } }, loadedBy: 'a', note: 'b', pool }));
        assert.deepEqual(busy.errors, ['collection.maxPlaces and collection.beatMs use more than half of the per-learner request limit']);
        for (const [by, note] of [['', 'x'], ['x', ''], ['  ', 'x'], ['x'.repeat(101), 'x'], ['x', 'あ'.repeat(501)]]) {
            assert.equal((/** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: by, note, pool }))).error_type, 'validation');
            assert.equal((/** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: by, note, pool }))).error_type, 'validation');
        }
        assert.deepEqual(pool.queries, []);
        assert.equal((/** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'a', note: 'b', pool: null }))).error_type, 'db_connection');
    });
});

describe('tools/core/trainingTime.js: a cohort\'s settings', () => {
    /** A cohort without settings, a catalog and rules loaded; the clock 2026-11-04 12:00 JST. */
    async function bare({ cohorts } = {}) {
        const pool = createTrainingTimePool({
            clock: at('2026-11-04T03:00:00Z'),
            stubs: [A],
            cohorts: cohorts ?? [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
            memberships: [{ user_id: A, cohort_id: COHORT }],
        });
        const catalog = /** @type {any} */ (await loadCatalog({ input: COURSE, loadedBy: 'a', note: 'b', pool }));
        const rules = /** @type {any} */ (await loadRules({ input: RULES_IN, loadedBy: 'a', note: 'b', pool }));
        const set = (patch = {}) => setCohortTime({ cohortSlug: SLUG, catalogSha256: catalog.sha256, rulesSha256: rules.sha256, effectiveFrom: '2026-11-04', setBy: 'staff-a', reason: 'JEED approved', pool, ...patch });
        return { pool, catalog, rules, set };
    }

    it('a first setting from today: the cohort row locked, the versions by sha256, then the insert; COMMIT', async () => {
        const { pool, set } = await bare();
        const result = /** @type {any} */ (await set());
        assert.deepEqual([result.status, result.effectiveFrom], ['set', '2026-11-04']);
        assert.deepEqual(pool.tx(), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_TIME_SQL.cohortForSetting, TRAINING_TIME_SQL.catalogBySha, TRAINING_TIME_SQL.rulesBySha,
            TRAINING_TIME_SQL.settingCourses, TRAINING_TIME_SQL.insertSetting, 'COMMIT']);
        assert.match(TRAINING_TIME_SQL.cohortForSetting, /FOR NO KEY UPDATE$/, 'does not wait for (or block) the foreign key checks of memberships and streams');
        assert.doesNotMatch(TRAINING_TIME_SQL.insertSetting, /set_at/, 'set_at is the default, the insert\'s own clock (the CHECK)');
        assert.equal(pool.state.settings.length, 1);
    });

    it('refused, each rolled back with nothing written: no cohort, no dates, unknown versions, a past day, after the last day', async () => {
        const { pool, set } = await bare({ cohorts: [
            { id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' },
            { id: 'c2200000-0000-4000-8000-000000000002', slug: 'undated', name: 'Undated', starts_on: '2026-11-01', ends_on: null },
        ] });
        const outcomes = [];
        for (const patch of [{ cohortSlug: 'nope' }, { cohortSlug: 'undated' }, { catalogSha256: 'f'.repeat(64) }, { rulesSha256: '0'.repeat(64) }, { effectiveFrom: '2026-11-03' }, { effectiveFrom: '2026-12-01' }]) {
            const r = /** @type {any} */ (await set(patch));
            outcomes.push(r.today ? `${r.status}:${r.today}` : r.status);
        }
        assert.deepEqual(outcomes, ['no_cohort', 'no_dates', 'no_catalog', 'no_rules', 'past:2026-11-04', 'after_end']);
        assert.equal(pool.state.settings.length, 0);
        assert.equal(pool.tx().filter((s) => s === 'COMMIT').length, 0);
        assert.equal(pool.tx().filter((s) => s === 'ROLLBACK').length, 6);
    });

    it('once a setting is in effect, a new one starts tomorrow at the earliest; a setting that is not in effect yet can be followed by one from today', async () => {
        const { pool, set } = await bare();
        assert.equal((/** @type {any} */ (await set({ effectiveFrom: '2026-11-10' }))).status, 'set', 'from a later day');
        assert.equal((/** @type {any} */ (await set())).status, 'set', 'none in effect yet: today is fine');
        const today = /** @type {any} */ (await set({ reason: 'again' }));
        assert.deepEqual([today.status, today.today], ['in_effect_today', '2026-11-04']);
        assert.equal((/** @type {any} */ (await set({ effectiveFrom: '2026-11-05' }))).status, 'set');
        assert.deepEqual(pool.state.settings.map((s) => s.effective_from), ['2026-11-10', '2026-11-04', '2026-11-05']);
    });

    it('another course\'s unit list: allowed while the cohort has no evidence, refused once it has', async () => {
        const { pool, set } = await bare();
        assert.equal((/** @type {any} */ (await set({ effectiveFrom: '2026-11-05' }))).status, 'set');
        const other = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, courseKey: 'other-course' }, loadedBy: 'a', note: 'b', pool }));
        assert.equal((/** @type {any} */ (await set({ catalogSha256: other.sha256, effectiveFrom: '2026-11-06' }))).status, 'set', 'no evidence yet');
        pool.addSignal({ userId: A, cohortId: COHORT, unit: U1, chain: chainId(1), born: at('2026-11-04T01:00:00Z'), seq: 0, at: at('2026-11-04T01:00:00Z'), input: true });
        assert.equal((/** @type {any} */ (await set({ catalogSha256: other.sha256, effectiveFrom: '2026-11-07' }))).status, 'course_differs');
        assert.equal(pool.state.settings.length, 2);
    });

    it('validation before any statement: the sha256 form, the day, who and why; midnight passing before the insert (23514) is a past day', async () => {
        const { pool, set } = await bare();
        const before = pool.queries.length;
        for (const patch of [{ catalogSha256: 'ABC' }, { rulesSha256: 'F'.repeat(64) }, { effectiveFrom: '2026-02-30' }, { effectiveFrom: '20261104' }, { setBy: ' ' }, { reason: '' }]) {
            assert.equal((/** @type {any} */ (await set(patch))).error_type, 'validation', JSON.stringify(patch));
        }
        assert.equal(pool.queries.length, before);
        pool.failOn(TRAINING_TIME_SQL.insertSetting, Object.assign(new Error('violates check constraint'), { code: '23514' }));
        assert.deepEqual(await set(), { status: 'past', today: '2026-11-04' });
        assert.equal(pool.tx().at(-1), 'ROLLBACK');
    });
});

describe('tools/core/trainingTime.js: closing days', () => {
    it('the account\'s shared lock, then the learner\'s lock (each its own statement), one clock reading, then the reads and the writes; COMMIT', async () => {
        const { pool } = await seeded();
        chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 });
        const result = await closeDays({ userId: A.toUpperCase(), cohortId: COHORT.toUpperCase(), computedBy: 'staff', pool });
        assert.deepEqual(result, { status: 'closed', days: 3, fromDay: '2026-11-01', toDay: '2026-11-03' });
        assert.deepEqual(pool.tx(), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.closeState, TRAINING_TIME_SQL.closeSettings,
            TRAINING_TIME_SQL.unitTotals, TRAINING_TIME_SQL.evidence, TRAINING_TIME_SQL.insertDays, TRAINING_TIME_SQL.insertUnitDays, 'COMMIT']);
        for (const q of pool.queries.filter((x) => x.tx && x.params.length && x.sql !== TRAINING_TIME_SQL.insertUnitDays)) {
            assert.ok(q.params[0] === A || q.params[0] === COHORT, `${q.sql.slice(0, 40)}: canonical ids`);
        }
        assert.deepEqual(pool.releases, [false]);
        assert.match(TRAINING_TIME_SQL.closeState, /clock_timestamp\(\)/);
        assert.equal((TRAINING_TIME_SQL.closeState.match(/clock_timestamp/g) ?? []).length, 1, 'the clock is read once');
        assert.match(TRAINING_TIME_SQL.insertDays, /WHERE EXISTS \(SELECT 1 FROM auth\.users WHERE id = \$1::uuid\)/);
        assert.match(TRAINING_TIME_SQL.insertDays, /ON CONFLICT \(user_id, cohort_id, day\) WHERE kind = 'close' AND account_deleted_at IS NULL DO NOTHING/);
        assert.doesNotMatch(TRAINING_TIME_SQL.insertDays, /computed_at/, 'the default, the insert\'s clock: a deletion\'s mark is never earlier');
        assert.match(TRAINING_TIME_SQL.evidence, /s\.account_deleted_at IS NULL/, 'a deleted account\'s marked streams are never evidence');
    });

    it('from the first day (the latest of the add day, the first setting, the cohort\'s first day) to yesterday; zero days too; the same numbers as the pure function', async () => {
        const { pool, catalog, rules } = await seeded();
        const signals = [
            ...chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 }),
            // Across 00:00 JST (15:00Z): two stream rows, one per day.
            ...chain(pool, { id: chainId(2), unit: U2, from: at('2026-11-02T14:59:00Z'), n: 20 }),
        ];
        assert.equal(pool.state.streams.length, 3);
        await close(pool);
        const days = pool.state.days;
        assert.deepEqual(days.map((d) => d.day), ['2026-11-01', '2026-11-02', '2026-11-03']);
        const want = countDays({
            fromDay: '2026-11-01', toDay: '2026-11-03', signals, rulesOf: () => RULES, setMsOf: () => setMsOf(COURSE),
            carriedMs: new Map(), cohort: cohortRange('2026-11-01', '2026-11-30'),
        }).days;
        for (const [i, d] of days.entries()) {
            const w = evidenceWindow(jstDayRange(d.day).start, jstDayRange(d.day).end, RULES.counting);
            const evidence = signals.filter((s) => s.at >= w.from && s.at <= w.to);
            assert.deepEqual(
                { counted: d.counted_ms, over: d.over_cap_ms, signals: d.signals, digest: d.evidence_sha256, kind: d.kind, by: d.computed_by, alg: d.algorithm, rules: d.rule_set_id, catalog: d.catalog_version_id },
                { counted: want[i].countedMs, over: want[i].units.reduce((n, u) => n + u.overCapMs, 0), signals: evidence.length, digest: evidenceDigest(evidence), kind: 'close', by: 'staff', alg: 'study-time/v1', rules: rules.id, catalog: catalog.id },
                d.day,
            );
            const units = pool.state.unitDays.filter((u) => u.day_id === d.id).map((u) => ({ unit: u.unit_key, countedMs: u.counted_ms, overCapMs: u.over_cap_ms }));
            assert.deepEqual(units, want[i].units, `${d.day} units`);
        }
        // Day 2: 19 pairs of 7 s on unit 1 (2 min set): 120 s counted, 13 s over; unit 2 up to 00:00 JST.
        assert.deepEqual(pool.state.unitDays.filter((u) => u.day_id === days[1].id).map((u) => [u.unit_key, u.counted_ms, u.over_cap_ms]), [[U1, 120 * S, 13 * S], [U2, 60 * S, 0]]);
        assert.equal(days[0].counted_ms, 0, 'a zero day has its row');
        assert.equal(pool.state.unitDays.filter((u) => u.day_id === days[0].id).length, 0, 'and no unit rows');
        assert.equal(days[0].evidence_sha256, sha256('[]'));
    });

    it('a day is final only once the clock is past its end + gapMs (strictly): until then the close stops the day before', async () => {
        const end = jstDayRange('2026-11-03').end;
        const { pool } = await seeded({ clock: end + 23 * S });
        assert.deepEqual(await close(pool), { status: 'closed', days: 2, fromDay: '2026-11-01', toDay: '2026-11-02' });
        pool.setClock(end + 23 * S + 1);
        assert.deepEqual(await close(pool), { status: 'closed', days: 1, fromDay: '2026-11-03', toDay: '2026-11-03' });
        assert.deepEqual(await close(pool), { status: 'nothing', reason: 'nothing_final' });
        assert.deepEqual(pool.state.days.map((d) => d.day), ['2026-11-01', '2026-11-02', '2026-11-03']);
    });

    it('a later close starts after the last closed day and carries each unit\'s time: the set time is reached across days', async () => {
        const { pool } = await seeded({ clock: at('2026-11-03T03:00:00Z') });
        chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 12 }); // 77 s
        await close(pool);
        chain(pool, { id: chainId(2), unit: U1, from: at('2026-11-03T01:00:00Z'), n: 12 }); // 77 s more, 43 s left
        pool.setClock(at('2026-11-04T03:00:00Z'));
        assert.deepEqual(await close(pool), { status: 'closed', days: 1, fromDay: '2026-11-03', toDay: '2026-11-03' });
        const day3 = pool.state.days.find((d) => d.day === '2026-11-03');
        assert.deepEqual([day3.counted_ms, day3.over_cap_ms], [43 * S, 34 * S]);
    });

    it('each day with its own setting: the version ids and the set times change on the setting\'s day', async () => {
        const { pool, rules } = await seeded();
        const wider = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: COURSE.units.map((u) => ({ ...u, setMinutes: 600 })) }, loadedBy: 'a', note: 'b', pool }));
        pool.addSetting({ cohortId: COHORT, catalogId: wider.id, ruleSetId: rules.id, effectiveFrom: '2026-11-03' });
        chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 });
        chain(pool, { id: chainId(2), unit: U1, from: at('2026-11-03T01:00:00Z'), n: 20 });
        await close(pool);
        const [, d2, d3] = pool.state.days;
        assert.deepEqual([d2.catalog_version_id === wider.id, d2.counted_ms, d2.over_cap_ms], [false, 120 * S, 13 * S]);
        assert.deepEqual([d3.catalog_version_id, d3.counted_ms, d3.over_cap_ms], [wider.id, 133 * S, 0], 'the new set time applies from its day; nothing counted before is taken back');
    });

    it('nothing to close, each rolled back with nothing written: no cohort, no account (deleted), not a learner, no dates, no setting, nothing final', async () => {
        const reasons = [];
        const { pool } = await seeded();
        reasons.push(await closeDays({ userId: A, cohortId: 'c2200000-0000-4000-8000-0000000000ff', computedBy: 'staff', pool }));
        reasons.push(await close(pool, NOBODY));
        reasons.push(await close(pool, B));
        pool.state.memberships.push({ user_id: B, cohort_id: COHORT, role: 'instructor', added_at: at('2026-10-31T00:00:00Z'), account_deleted_at: null });
        reasons.push(await close(pool, B));
        const undated = await seeded({ endsOn: null });
        reasons.push(await close(undated.pool));
        const unset = createTrainingTimePool({ stubs: [A], cohorts: [{ id: COHORT, slug: SLUG, name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }], memberships: [{ user_id: A, cohort_id: COHORT }] });
        reasons.push(await close(unset));
        const early = await seeded({ clock: at('2026-11-01T03:00:00Z') });
        reasons.push(await close(early.pool));
        assert.deepEqual(reasons.map((r) => /** @type {any} */ (r).reason), ['no_cohort', 'no_account', 'not_a_learner', 'not_a_learner', 'no_dates', 'not_configured', 'nothing_final']);
        for (const p of [pool, undated.pool, unset, early.pool]) {
            assert.equal(p.state.days.length, 0);
            assert.equal(p.tx().filter((s) => s === 'COMMIT').length, 0);
        }
    });

    it('a deleted account\'s marked membership and streams are ignored: a re-opened id starts again from its new add day', async () => {
        const { pool } = await seeded();
        chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 });
        for (const m of pool.state.memberships) m.account_deleted_at = at('2026-11-02T05:00:00Z');
        for (const s of pool.state.streams) s.account_deleted_at = at('2026-11-02T05:00:00Z');
        assert.deepEqual(await close(pool), { status: 'nothing', reason: 'not_a_learner' });
        pool.state.memberships.push({ user_id: A, cohort_id: COHORT, role: 'learner', added_at: at('2026-11-02T06:00:00Z'), account_deleted_at: null });
        assert.deepEqual(await close(pool), { status: 'closed', days: 2, fromDay: '2026-11-02', toDay: '2026-11-03' });
        assert.deepEqual(pool.state.days.map((d) => [d.day, d.counted_ms]), [['2026-11-02', 0], ['2026-11-03', 0]], 'the marked evidence is not counted');
    });

    it('a busy lock (55P03) is account_busy, rolled back; a stored version that no longer parses stops the close (invalid_setting); no database', async () => {
        const { pool } = await seeded();
        pool.failOn(TRAINING_SQL.learnerLock, Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }));
        const busy = /** @type {any} */ (await close(pool));
        assert.equal(busy.error_type, 'account_busy');
        assert.equal(pool.tx().at(-1), 'ROLLBACK');
        const broken = await seeded();
        broken.pool.state.rules[0].params.counting.gapMs = 1;
        assert.equal((/** @type {any} */ (await close(broken.pool))).error_type, 'invalid_setting');
        assert.equal(broken.pool.state.days.length, 0);
        assert.equal((/** @type {any} */ (await closeDays({ userId: A, cohortId: COHORT, computedBy: 'staff', pool: null }))).error_type, 'db_connection');
        assert.equal((/** @type {any} */ (await closeDays({ userId: 'x', cohortId: COHORT, computedBy: 'staff', pool }))).error_type, 'validation');
        assert.equal((/** @type {any} */ (await closeDays({ userId: A, cohortId: COHORT, computedBy: '', pool }))).error_type, 'validation');
    });
});

describe('tools/core/trainingTime.js: the pure parts', () => {
    it('signal rows and flags: 1 stop, 2 focus, 4 input', () => {
        assert.deepEqual(SIGNAL_FLAGS, { stop: 1, focus: 2, input: 4 });
        const s = signalOf({ chain_id: chainId(1), seq: 3, unit_key: U1, born: '1000', at: '8000', flags: 6 });
        assert.deepEqual(s, { chain: chainId(1), seq: 3, unit: U1, born: 1000, at: 8000, stop: false, focus: true, input: true });
        for (let flags = 0; flags <= 7; flags += 1) assert.equal(flagsOf(signalOf({ chain_id: 'c', seq: 0, unit_key: 'u', born: 0, at: 0, flags })), flags);
    });

    it('the evidence digest: independent of the order given, changed by any field', () => {
        const base = [
            { chain: chainId(2), seq: 0, unit: U1, born: 5, at: 5, stop: false, focus: true, input: true },
            { chain: chainId(1), seq: 1, unit: U2, born: 1, at: 9, stop: false, focus: false, input: true },
            { chain: chainId(1), seq: 0, unit: U2, born: 1, at: 1, stop: false, focus: false, input: true },
        ];
        const digest = evidenceDigest(base);
        assert.equal(digest, evidenceDigest([...base].reverse()));
        assert.equal(digest, sha256(canonicalJson([[chainId(1), 0, U2, 1, 1, 4], [chainId(1), 1, U2, 1, 9, 4], [chainId(2), 0, U1, 5, 5, 6]])));
        for (const patch of [{ seq: 2 }, { unit: 'x' }, { born: 6 }, { at: 6 }, { stop: true }, { focus: false }, { input: false }]) {
            assert.notEqual(evidenceDigest([{ ...base[0], ...patch }, base[1], base[2]]), digest, JSON.stringify(patch));
        }
    });

    it('the setting of a day: the latest effective day on or before it, the later row on the same day', () => {
        const s = (id, effectiveFrom) => /** @type {any} */ ({ id, effectiveFrom });
        const list = [s('1', '2026-11-01'), s('2', '2026-11-05'), s('3', '2026-11-05'), s('4', '2026-11-09')];
        assert.deepEqual(['2026-10-31', '2026-11-01', '2026-11-04', '2026-11-05', '2026-11-08', '2026-12-01'].map((d) => settingOf(list, d)?.id ?? null), [null, '1', '1', '3', '3', '4']);
    });

    it('closeRange: the first day, the last final day, the cohort\'s last day', () => {
        const settings = [/** @type {any} */ ({ id: '1', effectiveFrom: '2026-11-03', rules: RULES })];
        const base = { nowMs: at('2026-11-10T03:00:00Z'), startsOn: '2026-11-01', endsOn: '2026-11-30', addedOn: '2026-11-02', lastClosed: null, settings };
        assert.deepEqual(closeRange(base), { fromDay: '2026-11-03', toDay: '2026-11-09' }, 'the first setting is the latest start');
        assert.deepEqual(closeRange({ ...base, addedOn: '2026-11-05' }), { fromDay: '2026-11-05', toDay: '2026-11-09' });
        assert.deepEqual(closeRange({ ...base, lastClosed: '2026-11-07' }), { fromDay: '2026-11-08', toDay: '2026-11-09' });
        assert.deepEqual(closeRange({ ...base, endsOn: '2026-11-06' }), { fromDay: '2026-11-03', toDay: '2026-11-06' });
        assert.deepEqual(closeRange({ ...base, lastClosed: '2026-11-06', endsOn: '2026-11-06' }), { reason: 'nothing_final' });
        assert.deepEqual(closeRange({ ...base, nowMs: jstDayRange('2026-11-10').start + 5 * S }), { fromDay: '2026-11-03', toDay: '2026-11-08' }, '00:00:05 JST: yesterday is not final yet');
        assert.deepEqual(closeRange({ ...base, addedOn: null }), { reason: 'not_a_learner' });
        assert.deepEqual(closeRange({ ...base, startsOn: null }), { reason: 'no_dates' });
        assert.deepEqual(closeRange({ ...base, settings: [] }), { reason: 'not_configured' });
    });
});
