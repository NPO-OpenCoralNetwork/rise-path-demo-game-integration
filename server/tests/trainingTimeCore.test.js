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
//   before, and the same numbers as the pure function (shared/training/studyTime.js);
// - a signal (recordSignal): one transaction under the same three locks with lower-case ids, one
//   clock reading in whole milliseconds that the inserts take as a parameter, stored only while the
//   stub exists, in the stream row of its Japan-time day (the rows pool.addSignal seeds); each
//   refusal (409) and each ignore rolled back right after the decision with nothing stored, the
//   page's next beat (nextInMs) only while it keeps its chain; who may send one (the stub first: a
//   deletion that committed during the wait); the clock guard after a close (the closed day's end +
//   the gapMs it was counted with); then a close (computed by 'api') only once a day may be final,
//   whose failure keeps the signal, and the state as of the signal's clock in one read-only
//   snapshot (none for a stop), with the pure function's numbers;
// - reading study time (readStudyTime): learners only (the membership read decides before any
//   transaction), the close, then one read-only snapshot; the answer's keys in order, its statuses
//   (beatMs only in session), the newest LIVE_DAYS days, the pure function's numbers;
// - the pure parts behind them: the signal's body (exactly six keys), closeDue, liveRange, liveTime.
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
    API_CLOSER,
    LIVE_DAYS,
    SIGNAL_FLAGS,
    TRAINING_TIME_SQL,
    closeDays,
    closeDue,
    closeRange,
    evidenceDigest,
    flagsOf,
    liveRange,
    liveTime,
    loadCatalog,
    loadRules,
    parseSettings,
    readSignalBody,
    readStudyTime,
    recordSignal,
    setCohortTime,
    settingOf,
    signalOf,
    stateAfterSignal,
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
        const set = (patch = {}) => setCohortTime({ cohortSlug: SLUG, catalogSha256: catalog.sha256, rulesSha256: rules.sha256, effectiveFrom: '2026-11-04', setBy: 'staff-a', reason: 'approved for the cohort', pool, ...patch });
        return { pool, catalog, rules, set };
    }

    it('a first setting from today: the cohort\'s settings lock, the versions by sha256, today, then the insert deciding with one clock reading; COMMIT', async () => {
        const { pool, set } = await bare();
        const result = /** @type {any} */ (await set());
        assert.deepEqual([result.status, result.effectiveFrom], ['set', '2026-11-04']);
        assert.deepEqual(pool.tx(), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_TIME_SQL.cohortForSetting, TRAINING_TIME_SQL.settingsLock, TRAINING_TIME_SQL.catalogBySha,
            TRAINING_TIME_SQL.rulesBySha, TRAINING_TIME_SQL.jstToday, TRAINING_TIME_SQL.settingCourses, TRAINING_TIME_SQL.insertSetting, 'COMMIT']);
        assert.deepEqual(pool.queries.find((q) => q.sql === TRAINING_TIME_SQL.settingsLock)?.params, [COHORT]);
        assert.equal(TRAINING_TIME_SQL.settingsLock, "SELECT pg_advisory_xact_lock(hashtextextended('rp:training-settings:' || $1::uuid::text, 0))");
        assert.equal(TRAINING_TIME_SQL.settingsLockShared, "SELECT pg_advisory_xact_lock_shared(hashtextextended('rp:training-settings:' || $1::uuid::text, 0))");
        // One clock reading decides the day, is the row's set_at (the CHECK) and is the today it answers.
        assert.equal((TRAINING_TIME_SQL.insertSetting.match(/clock_timestamp\(\)/g) ?? []).length, 1);
        assert.match(TRAINING_TIME_SQL.insertSetting, /SELECT \$1::uuid, \$2, \$3, \$4::date, d\.at, \$5, \$6 FROM d/);
        assert.match(TRAINING_TIME_SQL.insertSetting, /WHERE \$4::date > d\.today\n\s+OR \(\$4::date = d\.today AND NOT EXISTS \(SELECT 1 FROM training_cohort_time_settings s WHERE s\.cohort_id = \$1::uuid AND s\.effective_from <= d\.today\)\)/);
        assert.doesNotMatch(TRAINING_TIME_SQL.cohortForSetting, /clock_timestamp|FOR /, 'today is read after the lock, not before a wait');
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
        assert.equal(pool.tx().filter((s) => s === TRAINING_TIME_SQL.settingsLock).length, 4, 'no cohort and no dates refuse before the lock');
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

    it('the course: any while there is no evidence; once there is, the course in effect today (new rules for it, undoing a switch scheduled before the evidence), never another', async () => {
        const { pool, rules, set } = await bare();
        const other = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, courseKey: 'other-course' }, loadedBy: 'a', note: 'b', pool }));
        const newer = /** @type {any} */ (await loadRules({ input: { ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 11 * S } }, loadedBy: 'a', note: 'b', pool }));
        // A mistake corrected before any evidence: two courses in the history, other-course in effect.
        assert.equal((/** @type {any} */ (await set())).status, 'set');
        assert.equal((/** @type {any} */ (await set({ catalogSha256: other.sha256, effectiveFrom: '2026-11-05' }))).status, 'set', 'no evidence yet');
        pool.setClock(at('2026-11-05T03:00:00Z'));
        pool.addSignal({ userId: A, cohortId: COHORT, unit: U1, chain: chainId(1), born: at('2026-11-05T01:00:00Z'), seq: 0, at: at('2026-11-05T01:00:00Z'), input: true });
        const sameNewRules = /** @type {any} */ (await set({ catalogSha256: other.sha256, rulesSha256: newer.sha256, effectiveFrom: '2026-11-06' }));
        const back = /** @type {any} */ (await set({ effectiveFrom: '2026-11-07' }));
        assert.equal(sameNewRules.status, 'set', 'the course in effect today, new rules');
        assert.deepEqual(back, { status: 'course_differs', courseKey: 'other-course' });
        // A switch scheduled before the evidence can be undone with the course in effect today.
        const switchy = await bare();
        await loadCatalog({ input: { ...COURSE, courseKey: 'other-course' }, loadedBy: 'a', note: 'b', pool: switchy.pool });
        assert.equal((/** @type {any} */ (await switchy.set())).status, 'set');
        assert.equal((/** @type {any} */ (await switchy.set({ catalogSha256: other.sha256, effectiveFrom: '2026-11-10' }))).status, 'set', 'scheduled before the evidence');
        switchy.pool.addSignal({ userId: A, cohortId: COHORT, unit: U1, chain: chainId(2), born: at('2026-11-04T01:00:00Z'), seq: 0, at: at('2026-11-04T01:00:00Z'), input: true });
        assert.equal((/** @type {any} */ (await switchy.set({ effectiveFrom: '2026-11-10', reason: 'undo the switch' }))).status, 'set');
        assert.equal((/** @type {any} */ (await switchy.set({ catalogSha256: other.sha256, effectiveFrom: '2026-11-12' }))).status, 'course_differs');
        assert.equal(rules.status, 'loaded');
    });

    it('midnight passing between the early checks and the insert: the insert\'s own day refuses (in effect today, or a past day), rolled back', async () => {
        const { pool, set } = await bare();
        assert.equal((/** @type {any} */ (await set())).status, 'set');
        const midnight = jstDayRange('2026-11-05').start;
        pool.before(TRAINING_TIME_SQL.insertSetting, () => pool.setClock(midnight + 3 * S));
        const tomorrow = /** @type {any} */ (await set({ effectiveFrom: '2026-11-05', reason: 'tomorrow, as read before midnight' }));
        assert.deepEqual(tomorrow, { status: 'in_effect_today', today: '2026-11-05' });
        assert.equal(pool.tx().at(-1), 'ROLLBACK');
        const fresh = await bare();
        fresh.pool.before(TRAINING_TIME_SQL.insertSetting, () => fresh.pool.setClock(midnight + 3 * S));
        assert.deepEqual(await fresh.set(), { status: 'past', today: '2026-11-05' });
        assert.deepEqual([pool.state.settings.length, fresh.pool.state.settings.length], [1, 0]);
    });

    it('validation before any statement: the sha256 form, the day, who and why', async () => {
        const { pool, set } = await bare();
        const before = pool.queries.length;
        for (const patch of [{ catalogSha256: 'ABC' }, { rulesSha256: 'F'.repeat(64) }, { effectiveFrom: '2026-02-30' }, { effectiveFrom: '20261104' }, { setBy: ' ' }, { reason: '' }]) {
            assert.equal((/** @type {any} */ (await set(patch))).error_type, 'validation', JSON.stringify(patch));
        }
        assert.equal(pool.queries.length, before);
    });
});

describe('tools/core/trainingTime.js: closing days', () => {
    it('the account\'s shared lock, the learner\'s lock, the cohort\'s settings lock shared (each its own statement), one clock reading, then the reads and the writes; COMMIT', async () => {
        const { pool } = await seeded();
        chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 });
        const result = await closeDays({ userId: A.toUpperCase(), cohortId: COHORT.toUpperCase(), computedBy: 'staff', pool });
        assert.deepEqual(result, { status: 'closed', days: 3, fromDay: '2026-11-01', toDay: '2026-11-03' });
        assert.deepEqual(pool.tx(), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared, TRAINING_TIME_SQL.closeState,
            TRAINING_TIME_SQL.closeSettings, TRAINING_TIME_SQL.unitTotals, TRAINING_TIME_SQL.evidence, TRAINING_TIME_SQL.insertDays, TRAINING_TIME_SQL.insertUnitDays, 'COMMIT']);
        assert.deepEqual(pool.queries.find((q) => q.sql === TRAINING_TIME_SQL.settingsLockShared)?.params, [COHORT]);
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

    it('each day with its own setting: the rules, the set times and both version ids change on the setting\'s day', async () => {
        const { pool, rules, catalog } = await seeded();
        const wider = /** @type {any} */ (await loadCatalog({ input: { ...COURSE, units: COURSE.units.map((u) => ({ ...u, setMinutes: 600 })) }, loadedBy: 'a', note: 'b', pool }));
        // Smaller pieces from day 3: each pair of signals 7 s apart counts 5 s instead of 7 s.
        const RULES_IN_2 = { ...RULES_IN, counting: { ...RULES_IN.counting, creditCapMs: 5 * S } };
        const rules2 = /** @type {any} */ (await loadRules({ input: RULES_IN_2, loadedBy: 'a', note: 'b', pool }));
        pool.addSetting({ cohortId: COHORT, catalogId: wider.id, ruleSetId: rules2.id, effectiveFrom: '2026-11-03' });
        const signals = [
            ...chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 }),
            ...chain(pool, { id: chainId(2), unit: U1, from: at('2026-11-03T01:00:00Z'), n: 20 }),
        ];
        await close(pool);
        const [, d2, d3] = pool.state.days;
        const later = (/** @type {string} */ day) => day >= '2026-11-03';
        const want = countDays({
            fromDay: '2026-11-01', toDay: '2026-11-03', signals, carriedMs: new Map(), cohort: cohortRange('2026-11-01', '2026-11-30'),
            rulesOf: (day) => (later(day) ? /** @type {any} */ (parseTimeRules(RULES_IN_2)).rules : RULES),
            setMsOf: (day) => setMsOf(later(day) ? { ...COURSE, units: COURSE.units.map((u) => ({ ...u, setMinutes: 600 })) } : COURSE),
        }).days;
        assert.deepEqual([d2.rule_set_id, d2.catalog_version_id, d2.counted_ms, d2.over_cap_ms], [rules.id, catalog.id, 120 * S, 13 * S]);
        assert.deepEqual([d3.rule_set_id, d3.catalog_version_id, d3.counted_ms, d3.over_cap_ms], [rules2.id, wider.id, 95 * S, 0],
            'day 3 with its own rules (19 × 5 s) and set time; nothing counted before is taken back');
        assert.deepEqual([d2.counted_ms, d3.counted_ms], [want[1].countedMs, want[2].countedMs]);
    });

    it('a close after an earlier close: the unit\'s time carried from the closed day and the evidence of the day before (a chain across 00:00 JST) give the numbers of one continuous count', async () => {
        // Day 2 is closed first; a chain starts 100 s before 00:00 JST of day 3, after unit 1 already reached its set time on day 2.
        const { pool } = await seeded({ clock: at('2026-11-03T03:00:00Z') });
        const signals = [
            ...chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 }),
            ...chain(pool, { id: chainId(2), unit: U1, from: jstDayRange('2026-11-03').start - 100 * S, n: 25 }),
        ];
        assert.deepEqual(await close(pool), { status: 'closed', days: 2, fromDay: '2026-11-01', toDay: '2026-11-02' });
        pool.setClock(at('2026-11-04T03:00:00Z'));
        assert.deepEqual(await close(pool), { status: 'closed', days: 1, fromDay: '2026-11-03', toDay: '2026-11-03' });
        const want = countDays({ fromDay: '2026-11-01', toDay: '2026-11-03', signals, rulesOf: () => RULES, setMsOf: () => setMsOf(COURSE), carriedMs: new Map(), cohort: cohortRange('2026-11-01', '2026-11-30') }).days;
        const d3 = pool.state.days.find((d) => d.day === '2026-11-03');
        const units = pool.state.unitDays.filter((u) => u.day_id === d3.id).map((u) => ({ unit: u.unit_key, countedMs: u.counted_ms, overCapMs: u.over_cap_ms }));
        assert.deepEqual({ counted: d3.counted_ms, over: d3.over_cap_ms, units }, { counted: want[2].countedMs, over: want[2].units.reduce((n, u) => n + u.overCapMs, 0), units: want[2].units });
        assert.equal(d3.counted_ms, 0, 'the set time was reached on day 2: day 3 counts nothing more for unit 1');
        assert.ok(d3.over_cap_ms > 0);
        const evidence = pool.queries.filter((q) => q.sql === TRAINING_TIME_SQL.evidence).at(-1);
        assert.ok(Date.parse(String(evidence?.params[4])) < jstDayRange('2026-11-03').start, 'the second close reads evidence from before its first day');
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

// Signals and live values (recordSignal, readStudyTime; the header's "A signal" and "Live values").

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (ms) => new Date(ms).toISOString();
/** A signal as the page sends it: chain 1 of unit 1, its first signal, with focus and input. */
const signalBody = (patch = {}) => ({ unitKey: U1, chainId: chainId(1), seq: 0, stop: false, focus: true, input: true, ...patch });
/** recordSignal for A in the cohort at the pool's clock. */
const send = (pool, patch = {}, ids = {}) => recordSignal({ userId: A, cohortId: COHORT, ...ids, signal: signalBody(patch), pool });
// A signal's transaction up to its decision, the same transaction storing it, a close up to its
// writes (closeDays), and the live values' read-only snapshot.
const DECIDED = ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared, TRAINING_TIME_SQL.signalState];
const STORED = [...DECIDED, TRAINING_TIME_SQL.insertStream, TRAINING_TIME_SQL.insertSignal, 'COMMIT'];
const CLOSING = ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared, TRAINING_TIME_SQL.closeState,
    TRAINING_TIME_SQL.closeSettings, TRAINING_TIME_SQL.unitTotals, TRAINING_TIME_SQL.evidence, TRAINING_TIME_SQL.insertDays];
const LIVE_READ = [TRAINING_TIME_SQL.beginRead, TRAINING_SQL.lockTimeout, TRAINING_TIME_SQL.closeState, TRAINING_TIME_SQL.closeSettings, TRAINING_TIME_SQL.unitTotals,
    TRAINING_TIME_SQL.currentDays, TRAINING_TIME_SQL.evidence, 'COMMIT'];
const rowsOf = (pool) => structuredClone({ streams: pool.state.streams, signals: pool.state.signals, days: pool.state.days, unitDays: pool.state.unitDays });
const lockBusy = () => Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
const connectionLost = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

/**
 * recordSignal that must store nothing: its transaction rolled back right after the decision (and
 * `after`, the statements it may still send), no COMMIT, no row changed. Returns the result.
 */
async function unstored(pool, patch = {}, { ids = {}, after = [] } = {}) {
    const before = rowsOf(pool);
    const mark = pool.tx().length;
    const result = await send(pool, patch, ids);
    assert.deepEqual(pool.tx().slice(mark), [...DECIDED, ...after, 'ROLLBACK'], JSON.stringify(patch));
    assert.deepEqual(rowsOf(pool), before, `${JSON.stringify(patch)}: nothing stored`);
    return result;
}

/**
 * The state of a signal's answer as the pure function counts the signals (every day from the
 * cohort's first to `toDay`): today's time and the unit's over all of them.
 */
function pureState({ signals, today, toDay = today, endsOn = '2026-11-30', unit = U1, reason }) {
    const { days, carriedAfterMs } = countDays({
        fromDay: '2026-11-01', toDay, signals, rulesOf: () => RULES, setMsOf: () => setMsOf(COURSE), carriedMs: new Map(), cohort: cohortRange('2026-11-01', endsOn),
    });
    const setMs = setMsOf(COURSE).get(unit);
    const countedMs = carriedAfterMs.get(unit) ?? 0;
    return { counting: reason === null, reason, todayMs: days.find((d) => d.day === today)?.countedMs ?? 0, unit: { unitKey: unit, countedMs, setMs, capReached: countedMs >= setMs } };
}

/** A chain's signals as the counting reads them, without a pool (input and focus on each). */
const beats = ({ id, unit, from, n, every = 7 * S }) => Array.from({ length: n }, (_, seq) => ({ chain: id, seq, unit, born: from, at: from + seq * every, stop: false, focus: true, input: true }));
/** A closeSettings row (the parsed versions as parseSettings reads them). */
const settingRow = (id, effectiveFrom, { rules = RULES_IN, manifest = COURSE } = {}) => ({ id, effective_from: effectiveFrom, rule_set_id: `r${id}`, catalog_version_id: `k${id}`, params: rules, manifest });

describe('tools/core/trainingTime.js: a signal (recordSignal), stored', () => {
    it('a new chain\'s seq 0, then its later seqs: decided and stored in one transaction under the three locks with lower-case ids (COMMIT), then the state in one read-only snapshot with the pure function\'s numbers; no close while no day is final', async () => {
        const t0 = at('2026-11-01T03:00:00Z'); // 12:00 JST on the cohort's first day: no day is final yet
        const { pool } = await seeded({ clock: t0 });
        const id = chainId(1);
        const sent = [];
        const results = [];
        // 7 s apart: seq 0 with focus and input, 1 focus only, 2 input only, 3 neither (flags 6, 2, 4, 0).
        for (const [seq, focus, input] of [[0, true, true], [1, true, false], [2, false, true], [3, false, false]]) {
            const now = t0 + seq * 7 * S;
            pool.setClock(now);
            results.push(await recordSignal({ userId: A.toUpperCase(), cohortId: COHORT.toUpperCase(), signal: signalBody({ chainId: id.toUpperCase(), seq, focus, input }), pool }));
            sent.push({ chain: id, seq, unit: U1, born: t0, at: now, stop: false, focus, input });
        }
        assert.deepEqual(results, sent.map((s, i) => ({
            status: 'accepted', nextInMs: 7 * S, state: pureState({ signals: sent.slice(0, i + 1), today: '2026-11-01', reason: i === 0 ? 'starting' : null }),
        })));
        assert.deepEqual(results.map((r) => /** @type {any} */ (r).state.todayMs), [0, 7 * S, 14 * S, 21 * S]);
        assert.deepEqual(pool.tx(), Array.from({ length: 4 }, () => [...STORED, ...LIVE_READ]).flat());
        // Every statement got the canonical (lower-case) ids; the inserts take the clock reading as a parameter.
        const uuids = new Set(pool.queries.filter((q) => q.tx).flatMap((q) => q.params).filter((p) => typeof p === 'string' && UUID.test(p)));
        assert.deepEqual([...uuids].sort(), [A, COHORT, id].sort());
        const paramsOf = (sql) => pool.queries.filter((q) => q.sql === sql).map((q) => q.params);
        assert.deepEqual(paramsOf(TRAINING_TIME_SQL.signalState), sent.map(() => [A, COHORT, id, U1]));
        assert.deepEqual(paramsOf(TRAINING_TIME_SQL.insertStream), sent.map((s) => [A, COHORT, U1, id, iso(t0), iso(s.at)]));
        assert.deepEqual(paramsOf(TRAINING_TIME_SQL.insertSignal), sent.map((s) => [A, id, iso(s.at), s.seq, flagsOf(s)]));
        // The live evidence: from the first day's start minus the widest look-back to the signal's clock.
        assert.deepEqual(paramsOf(TRAINING_TIME_SQL.evidence), sent.map((s) => [A, COHORT, '2026-11-01', '2026-11-01', iso(jstDayRange('2026-11-01').start - 101 * S), iso(s.at)]));
        assert.deepEqual(pool.state.signals.map((g) => [g.seq, g.flags]), [[0, 6], [1, 2], [2, 4], [3, 0]]);
        assert.deepEqual([pool.state.streams.length, pool.state.days.length], [1, 0]);
        assert.deepEqual(pool.releases, Array(8).fill(false));
    });

    it('a chain the seed stored goes on: the state carries its unit\'s time to the set time (capReached, cap_reached), the pure function\'s numbers', async () => {
        const t0 = at('2026-11-01T01:00:00Z');
        const { pool } = await seeded({ clock: t0 });
        const signals = chain(pool, { id: chainId(1), unit: U1, from: t0, n: 17 }); // 16 pairs: 112 s of the unit's 120 s
        const results = [];
        for (const seq of [17, 18]) {
            pool.setClock(t0 + seq * 7 * S);
            results.push(/** @type {any} */ (await send(pool, { seq, input: false })));
            signals.push({ chain: chainId(1), seq, unit: U1, born: t0, at: t0 + seq * 7 * S, stop: false, focus: true, input: false });
        }
        assert.deepEqual(results, [
            { status: 'accepted', nextInMs: 7 * S, state: pureState({ signals: signals.slice(0, 18), today: '2026-11-01', reason: null }) },
            { status: 'accepted', nextInMs: 7 * S, state: pureState({ signals, today: '2026-11-01', reason: 'cap_reached' }) },
        ]);
        assert.deepEqual(results.map((r) => r.state.unit), [
            { unitKey: U1, countedMs: 119 * S, setMs: 120 * S, capReached: false },
            { unitKey: U1, countedMs: 120 * S, setMs: 120 * S, capReached: true },
        ]);
        assert.equal(pool.state.streams.length, 1, 'the seeded stream of the day');
    });

    it('the state is as of the signal\'s clock: a pair another page stores between the signal\'s COMMIT and the read is not in this answer (the next read counts it)', async () => {
        const t0 = at('2026-11-01T03:00:00Z');
        const { pool } = await seeded({ clock: t0 });
        await send(pool);
        pool.setClock(t0 + 7 * S);
        let done = false;
        pool.before(TRAINING_TIME_SQL.beginRead, () => {
            if (done) return;
            done = true;
            chain(pool, { id: chainId(2), unit: U1, from: t0 + 8 * S, n: 2, every: 4 * S }); // 4 s of unit 1 after the signal
            pool.setClock(t0 + 13 * S);
        });
        const result = /** @type {any} */ (await send(pool, { seq: 1 }));
        assert.deepEqual(result.state, { counting: true, reason: null, todayMs: 7 * S, unit: { unitKey: U1, countedMs: 7 * S, setMs: 120 * S, capReached: false } });
        assert.equal(pool.queries.filter((q) => q.sql === TRAINING_TIME_SQL.evidence).at(-1)?.params[5], iso(t0 + 7 * S));
        // At 13 s page 1 is still open (its next signal could still change the time from 7 s on): the
        // read counts what is settled; once page 1 is no longer open (gapMs after its last signal) the
        // other page's 4 s are settled too. A number never goes down.
        const later = /** @type {any} */ (await readStudyTime({ userId: A, cohortId: COHORT, pool }));
        assert.deepEqual(later.time.days, [{ day: '2026-11-01', countedMs: 7 * S, final: false }]);
        pool.setClock(t0 + 7 * S + 23 * S + 1);
        const settled = /** @type {any} */ (await readStudyTime({ userId: A, cohortId: COHORT, pool }));
        assert.deepEqual(settled.time.days, [{ day: '2026-11-01', countedMs: 11 * S, final: false }]);
    });

    it('the statements: signalState reads the clock once, in whole milliseconds; the inserts take it as a parameter, only while the stub exists, once per chain and day (live rows) and once per seq; the chain and the open places are read from live streams only; the read-only snapshot', () => {
        assert.equal((TRAINING_TIME_SQL.signalState.match(/clock_timestamp/g) ?? []).length, 1);
        assert.match(TRAINING_TIME_SQL.signalState, /date_trunc\('milliseconds', clock_timestamp\(\)\)/);
        assert.doesNotMatch(TRAINING_TIME_SQL.signalState, /now\(\)/);
        for (const sql of [TRAINING_TIME_SQL.insertStream, TRAINING_TIME_SQL.insertSignal]) {
            assert.doesNotMatch(sql, /clock_timestamp|now\(\)/, 'the clock reading of signalState is a parameter');
        }
        // Only while the stub exists: the whole WHERE of the stream's insert, the last condition of the signal's.
        assert.match(TRAINING_TIME_SQL.insertStream, /\n WHERE EXISTS \(SELECT 1 FROM auth\.users WHERE id = \$1::uuid\)\nON CONFLICT/);
        assert.match(TRAINING_TIME_SQL.insertSignal, /\n WHERE s\.user_id = \$1::uuid AND [^\n]+\n[^\n]+\n {3}AND EXISTS \(SELECT 1 FROM auth\.users WHERE id = \$1::uuid\)\nON CONFLICT/);
        assert.match(TRAINING_TIME_SQL.insertStream, /ON CONFLICT \(user_id, chain_id, day\) WHERE account_deleted_at IS NULL DO NOTHING/);
        assert.match(TRAINING_TIME_SQL.insertSignal, /ON CONFLICT \(stream_id, seq\) DO NOTHING/);
        // The stream of the signal's Japan-time day, from the same instant.
        assert.match(TRAINING_TIME_SQL.insertStream, /\(\$6::timestamptz AT TIME ZONE 'Asia\/Tokyo'\)::date, \$6::timestamptz/);
        assert.match(TRAINING_TIME_SQL.insertSignal, /s\.day = \(\$3::timestamptz AT TIME ZONE 'Asia\/Tokyo'\)::date/);
        // The chain's last signal (any cohort) and the cohort's open chains: a deleted account's marked streams are never read.
        assert.match(TRAINING_TIME_SQL.signalState, /WHERE s\.user_id = \$1::uuid AND s\.chain_id = \$3::uuid AND s\.account_deleted_at IS NULL/);
        assert.match(TRAINING_TIME_SQL.signalState, /WHERE s\.user_id = \$1::uuid AND s\.cohort_id = c\.id AND s\.account_deleted_at IS NULL AND s\.day >= d\.today - 1/);
        assert.match(TRAINING_TIME_SQL.signalState, /WHERE m\.user_id = \$1::uuid AND m\.cohort_id = c\.id AND m\.account_deleted_at IS NULL/);
        assert.equal(TRAINING_TIME_SQL.beginRead, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    });

    it('the stored rows are, field by field, the rows pool.addSignal seeds for the same signals; a chain across 00:00 JST has one stream row per day with the same chain_started_at, each started_at its day\'s first signal', async () => {
        const born = jstDayRange('2026-11-02').start - 10 * S; // 23:59:50 JST on 11-01
        const { pool } = await seeded({ clock: born });
        const twin = (await seeded({ clock: born })).pool;
        const sent = [];
        const results = [];
        // seq, focus, input, stop: 7 s apart, 00:00 JST between seq 1 and 2, a stop last (before 11-01 is final).
        for (const [seq, focus, input, stop] of [[0, true, true, false], [1, true, false, false], [2, false, true, false], [3, false, false, false], [4, false, false, true]]) {
            const now = born + seq * 7 * S;
            pool.setClock(now);
            results.push(await send(pool, { seq, focus, input, stop }));
            twin.addSignal({ userId: A, cohortId: COHORT, unit: U1, chain: chainId(1), born, seq, at: now, stop, focus, input });
            sent.push({ chain: chainId(1), seq, unit: U1, born, at: now, stop, focus, input });
        }
        const streams = (p) => p.state.streams.map((s) => ({ user_id: s.user_id, cohort_id: s.cohort_id, unit_key: s.unit_key, chain_id: s.chain_id, chain_started_at: s.chain_started_at, day: s.day, started_at: s.started_at }));
        const signals = (p) => p.state.signals.map((g) => ({ day: p.state.streams.find((s) => s.id === g.stream_id).day, received_at: g.received_at, seq: g.seq, flags: g.flags }));
        assert.deepEqual(streams(pool), streams(twin));
        assert.deepEqual(signals(pool), signals(twin));
        assert.deepEqual(streams(pool).map((s) => [s.day, s.chain_started_at, s.started_at]), [['2026-11-01', born, born], ['2026-11-02', born, born + 14 * S]]);
        assert.deepEqual(signals(pool).map((g) => [g.day, g.seq, g.flags]), [['2026-11-01', 0, 6], ['2026-11-01', 1, 2], ['2026-11-02', 2, 4], ['2026-11-02', 3, 0], ['2026-11-02', 4, 1]]);
        // The answers after 00:00 JST: today's time from 00:00, the unit's over both days.
        assert.deepEqual(results.slice(2), [
            { status: 'accepted', nextInMs: 7 * S, state: pureState({ signals: sent.slice(0, 3), today: '2026-11-02', reason: null }) },
            { status: 'accepted', nextInMs: 7 * S, state: pureState({ signals: sent.slice(0, 4), today: '2026-11-02', reason: null }) },
            { status: 'accepted', nextInMs: null, state: null },
        ]);
        assert.deepEqual([/** @type {any} */ (results[2]).state.todayMs, /** @type {any} */ (results[2]).state.unit.countedMs], [4 * S, 14 * S]);
    });
});

describe('tools/core/trainingTime.js: a signal (recordSignal), not stored', () => {
    it('refused (409), rolled back right after the decision: time_not_configured, not_in_session (before the first day, after the last day for a new chain, no dates), unit_unknown, chain_mismatch (another unit, another cohort)', async () => {
        const t = at('2026-11-04T03:00:00Z');
        const COHORT_2 = 'c2200000-0000-4000-8000-000000000002';
        const cases = [
            ['time_not_configured', {}, (pool) => { pool.state.settings[0].effective_from = '2026-11-05'; }, {}], // a setting from tomorrow only
            ['not_in_session', { startsOn: '2026-11-05' }, null, {}],
            ['not_in_session', { endsOn: '2026-11-03' }, null, {}],
            ['not_in_session', { endsOn: null }, null, {}],
            ['unit_unknown', {}, null, { unitKey: 'sample-u3' }],
            ['chain_mismatch', {}, (pool) => pool.addSignal({ userId: A, cohortId: COHORT, unit: U2, chain: chainId(1), born: t - 7 * S, seq: 0, at: t - 7 * S, input: true }), { seq: 1 }],
            ['chain_mismatch', {}, (pool) => {
                pool.state.cohorts.push({ id: COHORT_2, slug: 'web-2026-10', name: 'Web 10', starts_on: '2026-10-01', ends_on: '2026-10-31' });
                pool.addSignal({ userId: A, cohortId: COHORT_2, unit: U1, chain: chainId(1), born: at('2026-10-30T03:00:00Z'), seq: 0, at: at('2026-10-30T03:00:00Z'), input: true });
            }, { seq: 1 }],
        ];
        const outcomes = [];
        for (const [reason, seed, prepare, patch] of cases) {
            const { pool } = await seeded({ clock: t, ...seed });
            prepare?.(pool);
            outcomes.push([reason, await unstored(pool, patch)]);
        }
        for (const [reason, result] of outcomes) assert.deepEqual(result, { status: 'refused', reason }, reason);
    });

    it('ignored, rolled back right after the decision: duplicate and too_soon keep the chain (nextInMs = beatMs); restart, not_open and chain_ended end it (null)', async () => {
        const t0 = at('2026-11-01T03:00:00Z');
        const { pool } = await seeded({ clock: t0 });
        assert.equal((/** @type {any} */ (await send(pool))).status, 'accepted');
        const outcomes = [];
        for (const [clock, patch] of [
            [t0, { seq: 1 }], // restart: the clock is not past the chain's last signal
            [t0 - 5 * S, { seq: 1 }], // restart: the clock went back
            [t0 + 2 * S, { seq: 1 }], // too_soon: 2 s after it (minSpacingMs 3 s)
            [t0 + 2 * S, { seq: 0 }], // duplicate: not after its last seq
            [t0 + 2 * S, { chainId: chainId(3), seq: 1 }], // not_open: a chain the server does not know, after seq 0
            [t0 + 2 * S, { chainId: chainId(4), stop: true }], // not_open: an unknown chain that starts with a stop
        ]) {
            pool.setClock(clock);
            outcomes.push(await unstored(pool, patch));
        }
        pool.setClock(t0 + 7 * S);
        assert.deepEqual(await send(pool, { seq: 1, stop: true }), { status: 'accepted', nextInMs: null, state: null });
        pool.setClock(t0 + 14 * S);
        outcomes.push(await unstored(pool, { seq: 2 }));
        assert.deepEqual(outcomes, [
            { status: 'ignored', reason: 'restart', nextInMs: null },
            { status: 'ignored', reason: 'restart', nextInMs: null },
            { status: 'ignored', reason: 'too_soon', nextInMs: 7 * S },
            { status: 'ignored', reason: 'duplicate', nextInMs: 7 * S },
            { status: 'ignored', reason: 'not_open', nextInMs: null },
            { status: 'ignored', reason: 'not_open', nextInMs: null },
            { status: 'ignored', reason: 'chain_ended', nextInMs: null },
        ]);
        assert.deepEqual(pool.state.signals.map((g) => [g.seq, g.flags]), [[0, 6], [1, 7]]);
    });

    it('other_place: a beat of a chain with maxPlaces newer open chains is ignored (null), nothing stored; its stop still passes', async () => {
        const t0 = at('2026-11-01T03:00:00Z');
        const { pool } = await seeded({ clock: t0 });
        for (const n of [1, 2, 3, 4]) {
            pool.setClock(t0 + (n - 1) * S);
            assert.equal((/** @type {any} */ (await send(pool, { chainId: chainId(n) }))).status, 'accepted', `chain ${n} opens`);
        }
        pool.setClock(t0 + 7 * S);
        assert.deepEqual(await unstored(pool, { chainId: chainId(1), seq: 1 }), { status: 'ignored', reason: 'other_place', nextInMs: null });
        assert.deepEqual(await send(pool, { chainId: chainId(1), seq: 1, stop: true, focus: false, input: false }), { status: 'accepted', nextInMs: null, state: null });
        pool.setClock(t0 + 8 * S);
        assert.equal((/** @type {any} */ (await send(pool, { chainId: chainId(2), seq: 1 }))).status, 'accepted', 'chain 1 stopped: chain 2 has two newer open chains');
    });

    it('the grace after the last day: a known chain\'s signal less than gapMs after the cohort\'s end is stored (its state: not_in_session, the time up to the end); a new chain is refused, and so is the known one at the end + gapMs', async () => {
        const end = jstDayRange('2026-11-03').end;
        const { pool } = await seeded({ endsOn: '2026-11-03', clock: end - 3 * S });
        const sent = [{ chain: chainId(1), seq: 0, unit: U1, born: end - 3 * S, at: end - 3 * S, stop: false, focus: true, input: true }];
        assert.deepEqual(await send(pool), { status: 'accepted', nextInMs: 7 * S, state: pureState({ signals: sent, today: '2026-11-03', endsOn: '2026-11-03', reason: 'starting' }) });
        pool.setClock(end + 4 * S);
        sent.push({ ...sent[0], seq: 1, at: end + 4 * S });
        const graced = /** @type {any} */ (await send(pool, { seq: 1 }));
        // Stored to close its last pair; the cohort is over, so the page sends no more (nextInMs null).
        assert.deepEqual(graced, { status: 'accepted', nextInMs: null, state: pureState({ signals: sent, today: '2026-11-04', toDay: '2026-11-03', endsOn: '2026-11-03', reason: 'not_in_session' }) });
        assert.deepEqual(graced.state, { counting: false, reason: 'not_in_session', todayMs: 0, unit: { unitKey: U1, countedMs: 3 * S, setMs: 120 * S, capReached: false } });
        assert.deepEqual(pool.state.streams.map((s) => s.day), ['2026-11-03', '2026-11-04'], 'stored in the stream of its own day, after the last one');
        assert.deepEqual(await unstored(pool, { chainId: chainId(2) }), { status: 'refused', reason: 'not_in_session' });
        pool.setClock(end + 23 * S);
        assert.deepEqual(await unstored(pool, { seq: 2 }), { status: 'refused', reason: 'not_in_session' });
    });
});

describe('tools/core/trainingTime.js: who may send a signal', () => {
    it('the stub gone because a deletion committed while the signal waited on the account lock: deleted_account (the tombstone read in the same transaction), rolled back with nothing stored; the deletion stays', async () => {
        const t = at('2026-11-01T03:00:00Z');
        const { pool } = await seeded({ clock: t });
        chain(pool, { id: chainId(1), unit: U1, from: t - 14 * S, n: 2 }); // A's open chain
        pool.before(TRAINING_SQL.lock, () => pool.deleteAccount(A, t - S));
        assert.deepEqual(await send(pool, { seq: 2 }), { status: 'deleted_account' });
        assert.deepEqual(pool.tx(), [...DECIDED, TRAINING_SQL.deletedAccount, 'ROLLBACK']);
        assert.deepEqual(pool.tx().slice(-3), [TRAINING_TIME_SQL.signalState, TRAINING_SQL.deletedAccount, 'ROLLBACK']);
        assert.deepEqual(pool.queries.filter((q) => q.sql === TRAINING_SQL.deletedAccount).map((q) => [q.params, q.tx]), [[[A], true]]);
        assert.deepEqual(pool.state.signals.map((g) => g.seq), [0, 1], 'nothing of the signal stored');
        // The deletion is another session's commit: the tombstone, no stub, the account's rows marked.
        assert.deepEqual(pool.state.tombstones.get(A), { deleted_at: t - S, reopened_at: null });
        assert.ok(!pool.state.stubs.includes(A));
        assert.deepEqual([...pool.state.memberships, ...pool.state.streams].map((r) => r.account_deleted_at), [t - S, t - S]);
    });

    it('no stub and no tombstone (or a re-opened one): no_account; no cohort, no membership, a marked membership: not_found; another role: not_a_learner; each rolled back with nothing stored', async () => {
        const { pool } = await seeded({ clock: at('2026-11-01T03:00:00Z') });
        pool.state.memberships.push({ user_id: NOBODY, cohort_id: COHORT, role: 'learner', added_at: at('2026-10-31T01:00:00Z'), account_deleted_at: null });
        const noStub = { ids: { userId: NOBODY }, after: [TRAINING_SQL.deletedAccount] };
        assert.deepEqual(await unstored(pool, {}, noStub), { status: 'no_account' }, 'the stub first, before the membership');
        pool.state.tombstones.set(NOBODY, { deleted_at: at('2026-10-20T00:00:00Z'), reopened_at: at('2026-10-21T00:00:00Z') });
        assert.deepEqual(await unstored(pool, {}, noStub), { status: 'no_account' }, 're-opened, the stub not written');
        assert.deepEqual(await unstored(pool, {}, { ids: { cohortId: 'c2200000-0000-4000-8000-0000000000ff' } }), { status: 'not_found' }, 'no cohort');
        assert.deepEqual(await unstored(pool, {}, { ids: { userId: B } }), { status: 'not_found' }, 'no membership');
        pool.state.memberships.push({ user_id: B, cohort_id: COHORT, role: 'instructor', added_at: at('2026-10-31T01:00:00Z'), account_deleted_at: null });
        assert.deepEqual(await unstored(pool, {}, { ids: { userId: B } }), { status: 'not_a_learner' });
        pool.state.memberships[0].account_deleted_at = at('2026-10-31T05:00:00Z');
        assert.deepEqual(await unstored(pool), { status: 'not_found' }, 'a marked membership (a stub again after a re-open)');
    });
});

describe('tools/core/trainingTime.js: a signal\'s failures and the clock guard', () => {
    it('a stored rules version that no longer parses: invalid_setting; a busy lock (55P03, each of the three): account_busy; both rolled back with nothing stored; no database; validation before any statement', async () => {
        const broken = await seeded({ clock: at('2026-11-01T03:00:00Z') });
        broken.pool.state.rules[0].params.counting.gapMs = 1;
        assert.deepEqual(await unstored(broken.pool), { error: 'A stored rules or unit list version does not parse with this code.', error_type: 'invalid_setting' });
        for (const lock of [TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared]) {
            const { pool } = await seeded({ clock: at('2026-11-01T03:00:00Z') });
            pool.failOn(lock, lockBusy());
            assert.deepEqual(await send(pool), { error: 'The account is busy. Try again.', error_type: 'account_busy' });
            assert.deepEqual(pool.tx().slice(-2), [lock, 'ROLLBACK']);
            assert.ok(!pool.tx().includes(TRAINING_TIME_SQL.signalState));
            assert.deepEqual([pool.state.streams.length, pool.state.signals.length, pool.releases], [0, 0, [false]]);
        }
        assert.deepEqual(await recordSignal({ userId: A, cohortId: COHORT, signal: signalBody(), pool: null }), { error: 'DB not configured', error_type: 'db_connection' });
        const { pool } = await seeded();
        const before = pool.queries.length;
        for (const params of [
            { userId: 'x' }, { userId: undefined }, { cohortId: SLUG }, { cohortId: null },
            { signal: { ...signalBody(), at: 1 } }, { signal: { ...signalBody(), seq: -1 } }, { signal: null }, { signal: JSON.stringify(signalBody()) },
        ]) {
            assert.deepEqual(await recordSignal({ userId: A, cohortId: COHORT, signal: signalBody(), pool, ...params }),
                { error: 'An account id, a cohort id (UUIDs) and a signal are required.', error_type: 'validation' }, JSON.stringify(params));
        }
        assert.equal(pool.queries.length, before);
    });

    it('the clock guard: after a close of day D counted with gapMs G, a signal at end(D) + G stores nothing (clock_behind), 1 ms later it is stored; G is the one D was counted with, not today\'s', async () => {
        const edge = jstDayRange('2026-11-03').end + 23 * S;
        for (const wider of [false, true]) {
            const { pool, catalog } = await seeded();
            if (wider) {
                // From 11-04 a wider gap: 11-03 is still counted with 23 s.
                const rules = /** @type {any} */ (await loadRules({ input: { ...RULES_IN, counting: { ...RULES_IN.counting, gapMs: 29 * S } }, loadedBy: 'a', note: 'b', pool }));
                pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom: '2026-11-04' });
            }
            assert.deepEqual(await close(pool), { status: 'closed', days: 3, fromDay: '2026-11-01', toDay: '2026-11-03' });
            pool.setClock(edge);
            assert.deepEqual(await unstored(pool), { status: 'clock_behind' }, `wider: ${wider}`);
            pool.setClock(edge + 1);
            const mark = pool.tx().length;
            assert.deepEqual(await send(pool), { status: 'accepted', nextInMs: 7 * S, state: { counting: false, reason: 'starting', todayMs: 0, unit: { unitKey: U1, countedMs: 0, setMs: 120 * S, capReached: false } } });
            assert.deepEqual(pool.tx().slice(mark), [...STORED, ...LIVE_READ], 'nothing more is final: no close');
            assert.deepEqual(pool.state.signals.map((g) => g.received_at), [edge + 1]);
        }
    });
});

describe('tools/core/trainingTime.js: after a stored signal, the close and the state', () => {
    it('a close follows only once a day may be final (its end + gapMs passed, strictly), in its own transaction between the signal\'s and the read, computed by the API', async () => {
        const edge = jstDayRange('2026-11-01').end + 23 * S;
        const { pool } = await seeded({ clock: edge });
        assert.equal((/** @type {any} */ (await send(pool))).status, 'accepted');
        assert.deepEqual(pool.tx(), [...STORED, ...LIVE_READ], 'at the end of 11-01 + gapMs, 11-01 is not final yet');
        pool.setClock(edge + 1);
        const mark = pool.tx().length;
        assert.deepEqual(await send(pool, { chainId: chainId(2) }), { status: 'accepted', nextInMs: 7 * S, state: { counting: false, reason: 'starting', todayMs: 0, unit: { unitKey: U1, countedMs: 0, setMs: 120 * S, capReached: false } } });
        assert.deepEqual(pool.tx().slice(mark), [...STORED, ...CLOSING, 'COMMIT', ...LIVE_READ]);
        assert.equal(API_CLOSER, 'api');
        assert.deepEqual(pool.state.days.map((d) => ({ day: d.day, by: d.computed_by, counted: d.counted_ms, signals: d.signals })), [{ day: '2026-11-01', by: API_CLOSER, counted: 0, signals: 1 }],
            'the signal at the end + gapMs is in 11-01\'s evidence, the next one is not');
        assert.equal(pool.state.signals.length, 2);
    });

    it('a failed close keeps the signal: accepted with closeError, and the state counting the days the close left open', async () => {
        const { pool } = await seeded(); // 11-04 12:00 JST: 11-01 to 11-03 are final
        const now = at('2026-11-04T03:00:00Z');
        const earlier = chain(pool, { id: chainId(9), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 5 }); // 28 s on 11-02
        pool.failOn(TRAINING_TIME_SQL.insertDays, connectionLost());
        const result = /** @type {any} */ (await send(pool));
        assert.deepEqual(result, {
            status: 'accepted', nextInMs: 7 * S, closeError: 'db_connection',
            state: pureState({ signals: [...earlier, { chain: chainId(1), seq: 0, unit: U1, born: now, at: now, stop: false, focus: true, input: true }], today: '2026-11-04', reason: 'starting' }),
        });
        assert.equal(result.state.unit.countedMs, 28 * S);
        assert.deepEqual(pool.tx(), [...STORED, ...CLOSING, 'ROLLBACK', ...LIVE_READ]);
        assert.deepEqual(pool.state.days, []);
        assert.equal(pool.state.signals.length, 6, 'the signal stays stored');
    });

    it('a failed live read keeps the signal: accepted, state null, stateError', async () => {
        const { pool } = await seeded({ clock: at('2026-11-01T03:00:00Z') });
        pool.failOn(TRAINING_TIME_SQL.currentDays, connectionLost()); // only the live read sends it here
        assert.deepEqual(await send(pool), { status: 'accepted', nextInMs: 7 * S, state: null, stateError: 'db_connection' });
        assert.deepEqual(pool.tx(), [...STORED, ...LIVE_READ.slice(0, 6), 'ROLLBACK']);
        assert.equal(pool.state.signals.length, 1);
    });

    it('a stop: accepted, nextInMs null, no state and nothing read after its COMMIT; a close that is due still runs', async () => {
        const t0 = at('2026-11-01T03:00:00Z');
        const { pool } = await seeded({ clock: t0 });
        await send(pool);
        pool.setClock(t0 + 7 * S);
        const mark = pool.tx().length;
        assert.deepEqual(await send(pool, { seq: 1, stop: true, focus: false, input: false }), { status: 'accepted', nextInMs: null, state: null });
        assert.deepEqual(pool.tx().slice(mark), STORED);
        assert.deepEqual(pool.state.signals.map((g) => [g.seq, g.flags]), [[0, 6], [1, 1]]);
        const due = await seeded(); // 11-04 12:00 JST
        due.pool.addSignal({ userId: A, cohortId: COHORT, unit: U1, chain: chainId(1), born: at('2026-11-04T02:59:53Z'), seq: 0, at: at('2026-11-04T02:59:53Z'), input: true });
        assert.deepEqual(await send(due.pool, { seq: 1, stop: true }), { status: 'accepted', nextInMs: null, state: null });
        assert.deepEqual(due.pool.tx(), [...STORED, ...CLOSING, 'COMMIT']);
    });
});

describe('tools/core/trainingTime.js: reading study time (readStudyTime)', () => {
    const read = (pool, userId = A, cohortId = COHORT) => readStudyTime({ userId, cohortId, pool });

    it('not a member, no such cohort: not_found from the membership read alone (no transaction); another role: not_a_learner, even when a stored version no longer parses (a learner\'s close stops on it); validation; no database', async () => {
        const { pool } = await seeded();
        const none = 'c2200000-0000-4000-8000-0000000000ff';
        let mark = pool.queries.length;
        assert.deepEqual(await read(pool, B), { status: 'not_found' });
        assert.deepEqual(await read(pool, A, none), { status: 'not_found' });
        assert.deepEqual(pool.queries.slice(mark).map((q) => [q.sql, q.params, q.tx]), [[TRAINING_SQL.liveMember, [B, COHORT], false], [TRAINING_SQL.liveMember, [A, none], false]]);
        pool.state.memberships.push({ user_id: B, cohort_id: COHORT, role: 'instructor', added_at: at('2026-10-31T00:00:00Z'), account_deleted_at: null });
        pool.state.rules[0].params.counting.gapMs = 1;
        mark = pool.queries.length;
        assert.deepEqual(await read(pool, B.toUpperCase(), COHORT.toUpperCase()), { status: 'not_a_learner' });
        assert.deepEqual(pool.queries.slice(mark).map((q) => [q.sql, q.params, q.tx]), [[TRAINING_SQL.liveMember, [B, COHORT], false]]);
        assert.deepEqual(await read(pool), { error: 'A stored rules or unit list version does not parse with this code.', error_type: 'invalid_setting' });
        assert.ok(!pool.tx().includes(TRAINING_TIME_SQL.beginRead));
        mark = pool.queries.length;
        for (const [userId, cohortId] of [['x', COHORT], [A, SLUG], [undefined, COHORT], [A, null]]) {
            assert.deepEqual(await readStudyTime({ userId, cohortId, pool }), { error: 'An account id and a cohort id (UUIDs) are required.', error_type: 'validation' }, `${userId} ${cohortId}`);
        }
        assert.equal(pool.queries.length, mark);
        assert.deepEqual(await readStudyTime({ userId: A, cohortId: COHORT, pool: null }), { error: 'DB not configured', error_type: 'db_connection' });
    });

    it('a learner: the membership read, the close (computed by the API), then the live values in one read-only snapshot; the answer\'s keys in order, lower-case ids, the pure function\'s numbers over every day', async () => {
        const { pool } = await seeded(); // 11-04 12:00 JST
        const signals = [
            ...chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 20 }), // 133 s: the set time (120 s) counted, 13 s over
            ...chain(pool, { id: chainId(2), unit: U2, from: at('2026-11-02T14:59:00Z'), n: 20 }), // across 00:00 JST: 60 s on 11-02, 73 s on 11-03
            ...chain(pool, { id: chainId(3), unit: U2, from: at('2026-11-04T01:00:00Z'), n: 10 }), // 63 s today
        ];
        const mark = pool.queries.length;
        const result = /** @type {any} */ (await readStudyTime({ userId: A.toUpperCase(), cohortId: COHORT.toUpperCase(), pool }));
        const sent = pool.queries.slice(mark);
        assert.deepEqual(sent.map((q) => q.sql), [TRAINING_SQL.liveMember, ...CLOSING, TRAINING_TIME_SQL.insertUnitDays, 'COMMIT', ...LIVE_READ]);
        assert.deepEqual(sent.map((q) => q.tx), [false, ...Array(sent.length - 1).fill(true)]);
        assert.deepEqual(sent.at(-2)?.params, [A, COHORT, '2026-11-04', '2026-11-04', iso(jstDayRange('2026-11-04').start - 101 * S), iso(at('2026-11-04T03:00:00Z'))], 'the live evidence up to the read\'s clock');
        assert.deepEqual(pool.state.days.map((d) => [d.day, d.computed_by]), [['2026-11-01', API_CLOSER], ['2026-11-02', API_CLOSER], ['2026-11-03', API_CLOSER]]);
        assert.equal(result.status, 'read');
        assert.deepEqual(Object.keys(result.time), ['learnerId', 'cohortId', 'today', 'timeZone', 'status', 'beatMs', 'units', 'days', 'totalMs', 'asOf']);
        const want = countDays({ fromDay: '2026-11-01', toDay: '2026-11-04', signals, rulesOf: () => RULES, setMsOf: () => setMsOf(COURSE), carriedMs: new Map(), cohort: cohortRange('2026-11-01', '2026-11-30') });
        assert.deepEqual(result.time, {
            learnerId: A,
            cohortId: COHORT,
            today: '2026-11-04',
            timeZone: 'Asia/Tokyo',
            status: 'ready',
            beatMs: 7 * S,
            units: COURSE.units.map((u) => {
                const setMs = u.setMinutes * 60 * S;
                const countedMs = want.carriedAfterMs.get(u.key) ?? 0;
                return { unitKey: u.key, title: u.title, setMs, countedMs, capReached: countedMs >= setMs };
            }),
            days: [...want.days].reverse().map((d) => ({ day: d.day, countedMs: d.countedMs, final: d.day !== '2026-11-04' })),
            totalMs: want.days.reduce((n, d) => n + d.countedMs, 0),
            asOf: '2026-11-04T03:00:00.000Z',
        });
        assert.deepEqual(result.time.units.map((u) => [u.unitKey, u.countedMs, u.capReached]), [[U1, 120 * S, true], [U2, 196 * S, false]]);
        assert.deepEqual(result.time.days.map((d) => [d.day, d.countedMs, d.final]), [['2026-11-04', 63 * S, false], ['2026-11-03', 73 * S, true], ['2026-11-02', 180 * S, true], ['2026-11-01', 0, true]]);
        assert.equal(result.time.totalMs, 316 * S);
    });

    it('days: the newest LIVE_DAYS (14) from today, none before the first day that counts, final once closed; totalMs over every day', async () => {
        assert.equal(LIVE_DAYS, 14);
        const { pool } = await seeded({ clock: at('2026-11-25T03:00:00Z') });
        chain(pool, { id: chainId(1), unit: U2, from: at('2026-11-05T01:00:00Z'), n: 3 }); // 14 s, older than the days listed
        chain(pool, { id: chainId(2), unit: U2, from: at('2026-11-20T01:00:00Z'), n: 4 }); // 21 s
        const { time } = /** @type {any} */ (await read(pool));
        assert.deepEqual(time.days.map((d) => d.day), Array.from({ length: 14 }, (_, i) => `2026-11-${String(25 - i).padStart(2, '0')}`));
        assert.deepEqual(time.days.map((d) => d.final), [false, ...Array(13).fill(true)]);
        assert.deepEqual(time.days.find((d) => d.day === '2026-11-20'), { day: '2026-11-20', countedMs: 21 * S, final: true });
        assert.deepEqual([time.totalMs, time.units.find((u) => u.unitKey === U2).countedMs], [35 * S, 35 * S]);
        const late = await seeded();
        late.pool.state.memberships[0].added_at = at('2026-11-03T01:00:00Z'); // added on 11-03 JST
        assert.deepEqual((/** @type {any} */ (await read(late.pool))).time.days, [{ day: '2026-11-04', countedMs: 0, final: false }, { day: '2026-11-03', countedMs: 0, final: true }]);
    });

    it('status: not_configured (no setting today: no units, no days, nothing counted), not_in_session (before the first day, after the last one): no beatMs in either', async () => {
        const keys = ['learnerId', 'cohortId', 'today', 'timeZone', 'status', 'units', 'days', 'totalMs', 'asOf'];
        const notConfigured = { learnerId: A, cohortId: COHORT, today: '2026-11-04', timeZone: 'Asia/Tokyo', status: 'not_configured', units: [], days: [], totalMs: 0, asOf: '2026-11-04T03:00:00.000Z' };
        const later = await seeded();
        later.pool.state.settings[0].effective_from = '2026-11-05'; // a setting from tomorrow only
        const unset = await seeded();
        unset.pool.state.settings.length = 0;
        for (const p of [later.pool, unset.pool]) {
            const { time } = /** @type {any} */ (await read(p));
            assert.deepEqual(time, notConfigured);
            assert.deepEqual(Object.keys(time), keys);
        }
        const early = await seeded({ startsOn: '2026-11-05' });
        const before = /** @type {any} */ (await read(early.pool)).time;
        assert.deepEqual([before.status, before.days, before.totalMs, before.units.map((u) => [u.unitKey, u.countedMs])], ['not_in_session', [], 0, [[U1, 0], [U2, 0]]]);
        assert.deepEqual(Object.keys(before), keys);
        const ended = await seeded({ endsOn: '2026-11-03', clock: at('2026-11-05T03:00:00Z') });
        chain(ended.pool, { id: chainId(1), unit: U2, from: at('2026-11-03T01:00:00Z'), n: 3 });
        const after = /** @type {any} */ (await read(ended.pool)).time;
        assert.deepEqual([after.status, after.today, after.totalMs], ['not_in_session', '2026-11-05', 14 * S]);
        assert.deepEqual(after.days, [{ day: '2026-11-03', countedMs: 14 * S, final: true }, { day: '2026-11-02', countedMs: 0, final: true }, { day: '2026-11-01', countedMs: 0, final: true }]);
        assert.deepEqual(Object.keys(after), keys);
    });

    it('a deletion that committed while it waited (on the close\'s account lock, or between the close and the read): deleted_account, the deletion kept; no stub and no tombstone: no_account; a busy close (55P03) fails the read', async () => {
        const deletedAt = at('2026-11-04T02:59:00Z');
        for (const [hook, statements, days] of [
            // The close finds no stub: nothing written, rolled back.
            [TRAINING_SQL.lock, ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_TIME_SQL.settingsLockShared, TRAINING_TIME_SQL.closeState, 'ROLLBACK'], 0],
            // The close committed; the snapshot finds no stub.
            [TRAINING_TIME_SQL.beginRead, [...CLOSING, TRAINING_TIME_SQL.insertUnitDays, 'COMMIT', TRAINING_TIME_SQL.beginRead, TRAINING_SQL.lockTimeout, TRAINING_TIME_SQL.closeState, 'COMMIT'], 3],
        ]) {
            const { pool } = await seeded();
            chain(pool, { id: chainId(1), unit: U1, from: at('2026-11-02T01:00:00Z'), n: 3 });
            let done = false;
            pool.before(hook, () => {
                if (done) return;
                done = true;
                pool.deleteAccount(A, deletedAt);
            });
            const mark = pool.queries.length;
            assert.deepEqual(await read(pool), { status: 'deleted_account' }, hook);
            assert.deepEqual(pool.queries.slice(mark).map((q) => q.sql), [TRAINING_SQL.liveMember, ...statements, TRAINING_SQL.deletedAccount]);
            assert.deepEqual(pool.queries.at(-1), { sql: TRAINING_SQL.deletedAccount, params: [A], tx: false });
            assert.deepEqual(pool.state.tombstones.get(A), { deleted_at: deletedAt, reopened_at: null });
            assert.ok(!pool.state.stubs.includes(A));
            assert.equal(pool.state.days.length, days);
            assert.ok([...pool.state.memberships, ...pool.state.streams, ...pool.state.days].every((r) => r.account_deleted_at === deletedAt), 'every row of the account marked');
        }
        const { pool } = await seeded();
        pool.state.memberships.push({ user_id: NOBODY, cohort_id: COHORT, role: 'learner', added_at: at('2026-10-31T01:00:00Z'), account_deleted_at: null });
        assert.deepEqual(await read(pool, NOBODY), { status: 'no_account' });
        const busy = await seeded();
        busy.pool.failOn(TRAINING_SQL.learnerLock, lockBusy());
        assert.deepEqual(await read(busy.pool), { error: 'The account is busy. Try again.', error_type: 'account_busy' });
        assert.ok(!busy.pool.tx().includes(TRAINING_TIME_SQL.beginRead));
    });
});

describe('tools/core/trainingTime.js: the pure parts of a signal and of the live values', () => {
    it('readSignalBody: exactly the six keys in any order (chainId lower-cased); a time, a duration or any other key, a missing key, a JSON "__proto__" key or an inherited one refuses the body', () => {
        assert.deepEqual(readSignalBody(signalBody({ chainId: chainId(1).toUpperCase(), seq: 7 })), { unitKey: U1, chainId: chainId(1), seq: 7, stop: false, focus: true, input: true });
        const json = `{"input":false,"focus":false,"stop":true,"seq":0,"chainId":"${chainId(2)}","unitKey":"${U2}"}`;
        assert.deepEqual(readSignalBody(JSON.parse(json)), { unitKey: U2, chainId: chainId(2), seq: 0, stop: true, focus: false, input: false });
        for (const key of ['at', 'durationMs', 'elapsedMs', 'clientTime', 'cohortId']) assert.equal(readSignalBody({ ...signalBody(), [key]: 1 }), null, key);
        for (const key of Object.keys(signalBody())) {
            const rest = signalBody();
            delete rest[key];
            assert.equal(readSignalBody(rest), null, `without ${key}`);
            assert.equal(readSignalBody({ ...rest, at: 1 }), null, `${key} replaced by at`);
        }
        // JSON.parse makes "__proto__" an own key (an object literal would set the prototype instead).
        const withProto = JSON.parse(`{"__proto__":{"at":1},${json.slice(1)}`);
        assert.ok(Object.hasOwn(withProto, '__proto__'));
        assert.equal(readSignalBody(withProto), null);
        const protoForUnit = JSON.parse(json.replace('"unitKey"', '"__proto__"'));
        assert.equal(Object.keys(protoForUnit).length, 6);
        assert.equal(readSignalBody(protoForUnit), null);
        // An inherited unitKey: with five own keys, and with six (another key in its place).
        const own = { chainId: chainId(1), seq: 0, stop: false, focus: true, input: true };
        assert.equal(readSignalBody(Object.assign(Object.create({ unitKey: U1 }), own)), null);
        assert.equal(readSignalBody(Object.assign(Object.create({ unitKey: U1 }), own, { at: 1 })), null);
    });

    it('readSignalBody: a unit key by the slug rule, a UUID, an integer 0..2147483647 and three booleans; anything but a plain object is null', () => {
        assert.equal(readSignalBody(signalBody({ seq: 2_147_483_647 }))?.seq, 2_147_483_647);
        assert.equal(readSignalBody(signalBody({ unitKey: 'a'.repeat(80) }))?.unitKey, 'a'.repeat(80));
        assert.equal(readSignalBody(signalBody({ unitKey: '0-a' }))?.unitKey, '0-a');
        for (const patch of [
            { seq: -1 }, { seq: 2_147_483_648 }, { seq: 1.5 }, { seq: '1' }, { seq: Number.NaN }, { seq: Infinity }, { seq: null }, { seq: 1n },
            { stop: 'false' }, { stop: 0 }, { focus: 1 }, { focus: null }, { input: 'true' }, { input: undefined },
            { unitKey: 'Sample-U1' }, { unitKey: '-u1' }, { unitKey: 'a'.repeat(81) }, { unitKey: '' }, { unitKey: 'u_1' }, { unitKey: 5 }, { unitKey: null },
            { chainId: 'not-a-uuid' }, { chainId: `${chainId(1)} ` }, { chainId: chainId(1).slice(1) }, { chainId: 7 }, { chainId: null },
        ]) {
            assert.equal(readSignalBody(signalBody(patch)), null, String(Object.entries(patch)[0]));
        }
        for (const body of [null, undefined, [], [signalBody()], 'x', JSON.stringify(signalBody()), 0, true]) assert.equal(readSignalBody(body), null, String(body));
    });

    it('readSignalBody: a key Object.keys does not list is still a key: "at" next to a non-enumerable own unitKey, or a symbol key, refuses the body (any other key refuses it)', () => {
        const hidden = { ...signalBody(), at: 1 };
        delete hidden.unitKey;
        Object.defineProperty(hidden, 'unitKey', { value: U1, enumerable: false });
        assert.equal(readSignalBody(hidden), null, 'seven own keys: at too');
        assert.equal(readSignalBody({ ...signalBody(), [Symbol('at')]: 1 }), null, 'a symbol key');
    });

    const DUE = Object.freeze({ nowMs: at('2026-11-04T03:00:00Z'), startsOn: '2026-11-01', endsOn: '2026-11-30', addedOn: '2026-10-31', firstSetting: '2026-11-01', lastClosed: null, yesterdayGapMs: 23 * S });

    it('closeDue: true while a final day is not closed yet (at 11-04 12:00 JST, 11-01 to 11-03 are final)', () => {
        assert.equal(closeDue(DUE), true);
        assert.equal(closeDue({ ...DUE, lastClosed: '2026-11-02' }), true);
    });

    it('closeDue: false once the last final day (yesterday) is closed', () => {
        assert.equal(closeDue({ ...DUE, lastClosed: '2026-11-03' }), false);
    });

    it('closeDue: yesterday is final only once the clock is past its end + yesterday\'s gapMs, strictly (closeRange\'s rule); with no setting yesterday, at once', () => {
        const end = jstDayRange('2026-11-03').end;
        const open = { ...DUE, lastClosed: '2026-11-02' };
        assert.equal(closeDue({ ...open, nowMs: end + 23 * S }), false);
        assert.equal(closeDue({ ...open, nowMs: end + 23 * S + 1 }), true);
        assert.equal(closeDue({ ...open, nowMs: end + 23 * S + 1, yesterdayGapMs: 29 * S }), false);
        assert.equal(closeDue({ ...open, nowMs: end + 1, yesterdayGapMs: null }), true);
        // The same answer as closeRange for the settings it would read.
        const settings = [/** @type {any} */ ({ id: '1', effectiveFrom: '2026-11-01', rules: RULES })];
        for (const nowMs of [end + 23 * S, end + 23 * S + 1]) {
            assert.equal(closeDue({ ...open, nowMs }), !('reason' in closeRange({ nowMs, startsOn: open.startsOn, endsOn: open.endsOn, addedOn: open.addedOn, lastClosed: open.lastClosed, settings })));
        }
    });

    it('closeDue: the first day is the latest of the add day, the first setting\'s day and the cohort\'s first day (a last closed day before it does not move it)', () => {
        for (const key of ['addedOn', 'firstSetting', 'startsOn']) {
            assert.equal(closeDue({ ...DUE, [key]: '2026-11-04' }), false, `${key} today: no day of it is final`);
            assert.equal(closeDue({ ...DUE, [key]: '2026-11-03' }), true, `${key} yesterday`);
        }
        assert.equal(closeDue({ ...DUE, lastClosed: '2026-10-20' }), true);
    });

    it('closeDue: at most the cohort\'s last day: after the end, false once the last day is closed', () => {
        const after = { ...DUE, nowMs: at('2026-11-20T03:00:00Z'), endsOn: '2026-11-02' };
        assert.equal(closeDue({ ...after, lastClosed: '2026-11-01' }), true);
        assert.equal(closeDue({ ...after, lastClosed: '2026-11-02' }), false);
    });

    it('closeDue: false without a learner\'s add day, a setting, or both dates in order (nothing can be closed)', () => {
        for (const patch of [{ addedOn: null }, { firstSetting: null }, { startsOn: null }, { endsOn: null }, { endsOn: '2026-10-30' }]) {
            assert.equal(closeDue({ ...DUE, ...patch }), false, JSON.stringify(patch));
        }
    });

    const SETTINGS = parseSettings([settingRow('1', '2026-11-01')]);
    const LIVE = Object.freeze({ nowMs: at('2026-11-04T03:00:00Z'), startsOn: '2026-11-01', endsOn: '2026-11-30', addedOn: '2026-10-31', lastClosed: null, settings: SETTINGS });

    it('liveRange: nothing closed: from the first day that counts to today, every day live', () => {
        assert.deepEqual(liveRange(LIVE), { first: '2026-11-01', toDay: '2026-11-04', live: { fromDay: '2026-11-01', toDay: '2026-11-04' } });
    });

    it('liveRange: live from the day after the last closed one; the first day stays', () => {
        assert.deepEqual(liveRange({ ...LIVE, lastClosed: '2026-11-02' }), { first: '2026-11-01', toDay: '2026-11-04', live: { fromDay: '2026-11-03', toDay: '2026-11-04' } });
    });

    it('liveRange: after the cohort\'s last day, up to it; live null once it is closed', () => {
        const ended = { ...LIVE, endsOn: '2026-11-02' };
        assert.deepEqual(liveRange({ ...ended, lastClosed: '2026-11-01' }), { first: '2026-11-01', toDay: '2026-11-02', live: { fromDay: '2026-11-02', toDay: '2026-11-02' } });
        assert.deepEqual(liveRange({ ...ended, lastClosed: '2026-11-02' }), { first: '2026-11-01', toDay: '2026-11-02', live: null });
    });

    it('liveRange: before the first day that counts (the latest of the add day, the first setting, the cohort\'s first day): no live day', () => {
        const want = { first: '2026-11-05', toDay: '2026-11-04', live: null };
        assert.deepEqual(liveRange({ ...LIVE, addedOn: '2026-11-05' }), want);
        assert.deepEqual(liveRange({ ...LIVE, startsOn: '2026-11-05' }), want);
        assert.deepEqual(liveRange({ ...LIVE, settings: parseSettings([settingRow('1', '2026-11-05')]) }), want);
    });

    it('liveRange: null when nothing counts: not a learner, a date missing or the dates reversed, no setting', () => {
        for (const patch of [{ addedOn: null }, { startsOn: null }, { endsOn: null }, { endsOn: '2026-10-30' }, { settings: [] }]) {
            assert.equal(liveRange({ ...LIVE, ...patch }), null, JSON.stringify(patch));
        }
    });

    it('liveTime: ready in session: the closed days as given (final), the open days counted as a close counts them with each unit\'s closed time carried (never stored)', () => {
        const signals = [
            ...beats({ id: chainId(1), unit: U1, from: at('2026-11-03T01:00:00Z'), n: 5 }), // 28 s, 20 s left of unit 1's 2 minutes
            ...beats({ id: chainId(2), unit: U2, from: at('2026-11-04T01:00:00Z'), n: 4 }), // 21 s today
        ];
        const cohort = cohortRange('2026-11-01', '2026-11-30');
        const carried = new Map([[U1, 100 * S]]);
        const want = countDays({ fromDay: '2026-11-03', toDay: '2026-11-04', signals, rulesOf: () => RULES, setMsOf: () => setMsOf(COURSE), carriedMs: carried, cohort });
        const time = liveTime({ ...LIVE, lastClosed: '2026-11-02', closedDays: [{ day: '2026-11-01', countedMs: 0 }, { day: '2026-11-02', countedMs: 100 * S }], unitTotals: carried, signals });
        assert.deepEqual(time, {
            today: '2026-11-04',
            status: 'ready',
            setting: SETTINGS[0],
            cohort,
            units: [
                { unitKey: U1, title: COURSE.units[0].title, setMs: 120 * S, countedMs: 120 * S, capReached: true },
                { unitKey: U2, title: COURSE.units[1].title, setMs: 1800 * S, countedMs: 21 * S, capReached: false },
            ],
            days: [
                { day: '2026-11-04', countedMs: 21 * S, final: false }, { day: '2026-11-03', countedMs: 20 * S, final: false },
                { day: '2026-11-02', countedMs: 100 * S, final: true }, { day: '2026-11-01', countedMs: 0, final: true },
            ],
            totalMs: 141 * S,
            todayMs: 21 * S,
            unitMs: want.carriedAfterMs,
        });
        assert.deepEqual(want.days.map((d) => d.countedMs), [20 * S, 21 * S]);
        assert.deepEqual(carried, new Map([[U1, 100 * S]]), 'the closed units are not changed');
    });

    it('liveTime: units in the unit list\'s order with their titles (not by key); a unit no longer listed still counts in totalMs', () => {
        const settings = parseSettings([settingRow('1', '2026-11-01', { manifest: { ...COURSE, units: [...COURSE.units].reverse() } })]);
        const closedDays = [{ day: '2026-11-01', countedMs: 0 }, { day: '2026-11-02', countedMs: 0 }, { day: '2026-11-03', countedMs: 30 * S }];
        const time = liveTime({ ...LIVE, settings, lastClosed: '2026-11-03', closedDays, unitTotals: new Map([['sample-u9', 30 * S]]), signals: [] });
        assert.deepEqual(time.units.map((u) => [u.unitKey, u.title, u.countedMs]), [[U2, COURSE.units[1].title, 0], [U1, COURSE.units[0].title, 0]]);
        assert.equal(time.totalMs, 30 * S);
    });

    it('liveTime: days are the newest LIVE_DAYS from today, none before the first day that counts; totalMs over every day', () => {
        const closedDays = Array.from({ length: 24 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, '0')}`, countedMs: S }));
        const late = { ...LIVE, nowMs: at('2026-11-25T03:00:00Z'), lastClosed: '2026-11-24', closedDays, unitTotals: new Map(), signals: [] };
        const time = liveTime(late);
        assert.equal(time.days.length, LIVE_DAYS);
        assert.deepEqual([time.days[0], time.days.at(-1)], [{ day: '2026-11-25', countedMs: 0, final: false }, { day: '2026-11-12', countedMs: S, final: true }]);
        assert.equal(time.totalMs, 24 * S, 'the days not listed count too');
        const added = liveTime({ ...late, addedOn: '2026-11-20', closedDays: closedDays.slice(19) });
        assert.deepEqual(added.days.map((d) => d.day), ['2026-11-25', '2026-11-24', '2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20']);
    });

    it('liveTime: not_configured without a setting today (one from a later day): no units, no days, nothing counted', () => {
        const settings = parseSettings([settingRow('1', '2026-11-10')]);
        assert.deepEqual(liveTime({ ...LIVE, settings, closedDays: [], unitTotals: new Map(), signals: [] }), {
            today: '2026-11-04', status: 'not_configured', setting: null, cohort: cohortRange('2026-11-01', '2026-11-30'), units: [], days: [], totalMs: 0, todayMs: 0, unitMs: new Map(),
        });
    });

    it('liveTime: not_in_session outside [00:00 JST of the first day, 00:00 JST after the last day) or without both dates; the units are still listed', () => {
        const base = { ...LIVE, settings: parseSettings([settingRow('1', '2026-10-25')]), closedDays: [], unitTotals: new Map(), signals: [] };
        const { start } = jstDayRange('2026-11-01');
        const { end } = jstDayRange('2026-11-30');
        assert.deepEqual([start - 1, start, end - 1, end].map((nowMs) => liveTime({ ...base, nowMs }).status), ['not_in_session', 'ready', 'ready', 'not_in_session']);
        const undated = liveTime({ ...base, endsOn: null });
        assert.deepEqual([undated.status, undated.days, undated.units.map((u) => u.unitKey)], ['not_in_session', [], [U1, U2]]);
    });

    it('stateAfterSignal: null without today\'s setting or when today\'s unit list lacks the unit (no state is guessed)', () => {
        const base = { ...LIVE, closedDays: [], unitTotals: new Map(), signals: [] };
        const signal = /** @type {any} */ (readSignalBody(signalBody()));
        const unset = liveTime({ ...base, settings: parseSettings([settingRow('1', '2026-11-10')]) });
        assert.equal(stateAfterSignal({ nowMs: LIVE.nowMs, signal, prevAt: null, time: unset, signals: [] }), null);
        const time = liveTime(base);
        assert.equal(stateAfterSignal({ nowMs: LIVE.nowMs, signal: { ...signal, unitKey: 'sample-u3' }, prevAt: null, time, signals: [] }), null);
        assert.deepEqual(stateAfterSignal({ nowMs: LIVE.nowMs, signal, prevAt: null, time, signals: [] }), { counting: false, reason: 'starting', todayMs: 0, unit: { unitKey: U1, countedMs: 0, setMs: 120 * S, capReached: false } });
    });
});
