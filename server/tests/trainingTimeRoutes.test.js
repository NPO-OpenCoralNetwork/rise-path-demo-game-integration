// Study time over HTTP (doc/brushup-2026/training-plan.ja.md §4.9; server/routes/trainingTime.js, used
// inside server/routes/training.js) on the real server.js stack, with a fake Supabase and the in-memory
// database of helpers/trainingTimePool.js (exact SQL, the sign-in's two statements included):
// - the switch: unless TRAINING_ENABLED is exactly "true", GET .../time and POST .../time/signals answer
//   404 training_off before auth and the body check (no Supabase call, no statement);
// - a signal's body is exactly { unitKey, chainId, seq, stop, focus, input } (no time, no duration):
//   anything else 400 validation with fixed text that never echoes the value, after the sign-in's
//   statements only; JSON that is not an object or an array is the training parser's 400 invalid_body;
// - the cohort: an id that is not a UUID (before any training statement), a missing cohort and one
//   without the caller's live membership answer one 404 cohort_not_found; an instructor 403;
// - the answers: accepted, a stop, ignored (nextInMs beatMs or null); the GET's keys in order, beatMs
//   only while ready; no-store; beatMs is the only rule value any answer carries;
// - 409 refusals and 401 account_deleted (a deletion committed during the lock wait) store nothing;
//   503 training_unavailable (Retry-After: 60) and 500 training_failed carry no driver text, operation
//   name or SQL; the per-learner limit counts these routes together with GET /me.
// The values are artificial, not the school's (training-plan D9).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { ACCOUNT_DELETED_REFUSAL, setSupabaseForTests } from '../middleware/auth.js';
import { TRAINING_REQUESTS_PER_MINUTE } from '../routes/training.js';
import { jstDayRange } from '../../shared/training/studyTime.js';
import { TRAINING_SQL } from '../../tools/core/training.js';
import { TRAINING_TIME_SQL, loadCatalog, loadRules } from '../../tools/core/trainingTime.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { createTrainingPool } from './helpers/trainingPool.js';
import { AUTH_SQL, createTrainingTimePool } from './helpers/trainingTimePool.js';

const S = 1000;
const A = 'aaaaaaaa-2424-4000-8000-0000000000a1'; // a learner of COHORT
const B = 'aaaaaaaa-2424-4000-8000-0000000000b2'; // only a row in COHORT that an earlier deletion marked
const NOBODY = 'aaaaaaaa-2424-4000-8000-0000000000e0'; // in no cohort
const TEACHER = 'aaaaaaaa-2424-4000-8000-0000000000c3'; // an instructor of COHORT
const COHORT = 'c2400000-0000-4000-8000-000000000001';
const OTHER = 'c2400000-0000-4000-8000-000000000002';
const MISSING = 'c2400000-0000-4000-8000-0000000000ff';
const U1 = 'sample-u1'; // 2 minutes
const U2 = 'sample-u2'; // 30 minutes
const COURSE = JSON.parse(fs.readFileSync(new URL('./fixtures/training/sample-course.json', import.meta.url), 'utf8'));
// Artificial rules, each value a distinctive number, so the answers can be searched for them. They pass
// parseTimeRules with the API's 60 requests a minute (3 pages at one signal per 7.349 s use 25 of 30).
const RULES_IN = Object.freeze({
    algorithm: 'study-time/v1',
    collection: { beatMs: 7_349, minSpacingMs: 3_187, maxPlaces: 3 },
    counting: { gapMs: 23_459, creditCapMs: 13_267, idleMs: 101_573, requireFocus: false, overlap: 'drop_conflicts' },
});
const BEAT = RULES_IN.collection.beatMs;
/** The rule values that never leave the server: as numbers, and as text (also formatted). */
const HIDDEN_MS = [RULES_IN.collection.minSpacingMs, RULES_IN.counting.gapMs, RULES_IN.counting.creditCapMs, RULES_IN.counting.idleMs];
const HIDDEN = [...HIDDEN_MS.map(String), ...HIDDEN_MS.map((v) => v.toLocaleString('en-US')), RULES_IN.counting.overlap];

const at = (iso) => Date.parse(iso);
/** 12:00 Japan time on 2026-11-04, the cohort's 4th day. */
const T0 = at('2026-11-04T03:00:00Z');
const chainId = (n) => `cccccccc-2424-4000-8000-${String(n).padStart(12, '0')}`;
/** A signal's body: a page of unit 1 that had focus and input. */
const signal = (patch = {}) => ({ unitKey: U1, chainId: chainId(1), seq: 0, stop: false, focus: true, input: true, ...patch });
const without = (body, key) => Object.fromEntries(Object.entries(body).filter(([k]) => k !== key));

const ME = '/api/v2/training/me';
const TIME = (cohort = COHORT) => `/api/v2/training/cohorts/${cohort}/time`;
const SIGNALS = (cohort = COHORT) => `${TIME(cohort)}/signals`;
const OFF = { error: 'Training is not offered here.', error_type: 'training_off' };
const NOT_FOUND = { ok: false, error: 'No such cohort for this account.', error_type: 'cohort_not_found' };
const NOT_A_LEARNER = { ok: false, error: 'Only a learner of this cohort has study time.', error_type: 'not_a_learner' };
const BAD_SIGNAL = {
    ok: false,
    error: 'Send a JSON object with exactly { unitKey, chainId, seq, stop, focus, input }: a unit key, a UUID, an integer from 0 to 2147483647 and three booleans.',
    error_type: 'validation',
};
const INVALID_BODY = { error: 'The request body is not valid JSON.', error_type: 'invalid_body' };
const UNAVAILABLE = { ok: false, error: 'Training is unavailable right now. Please try again later.', error_type: 'training_unavailable' };
const READ_FAILED = { ok: false, error: 'Study time could not be read.', error_type: 'training_failed' };
const SIGNAL_FAILED = { ok: false, error: 'The signal could not be recorded.', error_type: 'training_failed' };
// The sign-in's 401 body (server/middleware/auth.js, as server/routes/legal.js): one shape for the page.
const DELETED = { ...ACCOUNT_DELETED_REFUSAL };
const RATE_LIMITED = { error: 'Too many requests. Please try again in a minute.', error_type: 'rate_limited' };
const REFUSED = {
    time_not_configured: 'Study time is not set up for this cohort today.',
    not_in_session: 'The cohort is not in session.',
    unit_unknown: 'This unit is not in the cohort\'s unit list today.',
    chain_mismatch: 'This chain belongs to another unit or cohort. Start a new chain.',
};
/** What requireAuth sends for a session. */
const SIGN_IN = new Set([AUTH_SQL.tombstone, AUTH_SQL.stubInsert]);
/** A signal decided without storing it: the sign-in, the three locks, one clock reading, rolled back. */
const NOT_STORED = [AUTH_SQL.tombstone, AUTH_SQL.stubInsert, 'BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock,
    TRAINING_TIME_SQL.settingsLockShared, TRAINING_TIME_SQL.signalState, 'ROLLBACK'];
/** The driver's text, SQL, the core's operation names and error types: never in an answer. */
const DRIVER = 'relation "training_time_signals" (host db.internal:5432, password=hunter2)';
const LEAK = /relation|db\.internal|hunter2|training_time_|training_memberships|account_deletions|auth\.users|SELECT|INSERT|pg_advisory|recordSignal|readStudyTime|closeDays|studyTimeState|lock timeout|does not parse|Duplicate|conflict|db_connection|table_not_found|permission_denied|account_busy|invalid_setting|ECONNREFUSED|55P03|42P01|42501|23505/;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ role: 'authenticated', exp: 4_000_000_000, ...payload })}.c2ln`;
const as = (sub) => ({ Authorization: `Bearer ${jwt({ sub, aud: 'authenticated' })}` });

/** Supabase accepts every token and names its sub. */
const supabase = {
    calls: 0,
    auth: {
        getUser: async (token) => {
            supabase.calls += 1;
            const id = decodeTokenClaims(token)?.sub;
            if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
            return { data: { user: { id, is_anonymous: false } }, error: null };
        },
    },
};

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY', 'TRAINING_ENABLED', 'LEGAL_TERMS_REQUIRED'];

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const call = async (url, { method = 'GET', headers = {}, body, rawBody, type = 'application/json' } = {}) => {
    const init = { method, headers: { ...headers } };
    if (rawBody !== undefined || body !== undefined) {
        init.headers['content-type'] = type;
        init.body = rawBody ?? JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text, headers: response.headers };
};

const get = (base, { user = A, cohort = COHORT } = {}) => call(`${base}${TIME(cohort)}`, { headers: as(user) });
const post = (base, body, { user = A, cohort = COHORT } = {}) => call(`${base}${SIGNALS(cohort)}`, { method: 'POST', headers: as(user), body });

/** Runs fn with console.warn and console.error recorded instead of printed; returns the lines. */
const logged = async (fn) => {
    const { error, warn } = console;
    const lines = [];
    console.error = (...args) => lines.push(args.map(String).join(' '));
    console.warn = (...args) => lines.push(args.map(String).join(' '));
    try {
        await fn();
    } finally {
        console.error = error;
        console.warn = warn;
    }
    return lines;
};

/** The statements sent since `from` (an index into pool.queries). */
const sentSince = (pool, from) => pool.queries.slice(from).map((q) => q.sql);
const stored = (pool) => [pool.state.streams.length, pool.state.signals.length, pool.state.days.length];

/**
 * The app's database from here on: COHORT (November 2026; OTHER beside it) with A as a learner (added
 * 10-31 JST), TEACHER as an instructor and B's row marked by an earlier deletion; the sample unit list
 * and the rules loaded and, unless `setting` is false, in effect from `effectiveFrom`; the clock at T0.
 */
async function seeded({ endsOn = '2026-11-30', effectiveFrom = '2026-11-01', setting = true } = {}) {
    const pool = createTrainingTimePool({
        clock: T0,
        cohorts: [
            { id: COHORT, slug: 'web-2026-11', name: 'Web', starts_on: '2026-11-01', ends_on: endsOn },
            { id: OTHER, slug: 'web-2026-11-b', name: 'Web B', starts_on: '2026-11-01', ends_on: '2026-11-30' },
        ],
        memberships: [
            { user_id: A, cohort_id: COHORT, added_at: at('2026-10-31T01:00:00Z') },
            { user_id: TEACHER, cohort_id: COHORT, role: 'instructor', added_at: at('2026-10-31T01:00:00Z') },
            { user_id: B, cohort_id: COHORT, added_at: at('2026-10-31T01:00:00Z'), account_deleted_at: at('2026-11-02T00:00:00Z') },
        ],
    });
    const catalog = await loadCatalog({ input: COURSE, loadedBy: 'staff-a', note: 'sample', pool });
    const rules = await loadRules({ input: RULES_IN, loadedBy: 'staff-a', note: 'sample', pool });
    assert.deepEqual([catalog.status, rules.status], ['loaded', 'loaded'], 'the artificial rules pass with the API\'s request limit');
    if (setting) pool.addSetting({ cohortId: COHORT, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom });
    setPoolForTests(pool);
    return { pool, catalog, rules };
}

/** Every number in an answer, with the key it is under. @returns {Array<[string, number]>} */
const numbersOf = (value, key = '') => {
    if (typeof value === 'number') return [[key, value]];
    if (Array.isArray(value)) return value.flatMap((v) => numbersOf(v, key));
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => numbersOf(v, k));
    return [];
};

describe('study time on the server.js stack (/api/v2/training/cohorts/:cohortId/time)', () => {
    const saved = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        process.env.TRAINING_ENABLED = 'true';
        resetPoolForTests();
        supabase.calls = 0;
        setSupabaseForTests(supabase);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });

    it('off unless TRAINING_ENABLED is exactly "true": both routes 404 training_off, before auth and the body check (no Supabase call, no statement)', async () => {
        const pool = createTrainingTimePool({
            cohorts: [{ id: COHORT, slug: 'web-2026-11', name: 'Web', starts_on: '2026-11-01', ends_on: '2026-11-30' }],
            memberships: [{ user_id: A, cohort_id: COHORT }],
        });
        setPoolForTests(pool);
        for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', ' true', 'true ']) {
            if (value === undefined) delete process.env.TRAINING_ENABLED;
            else process.env.TRAINING_ENABLED = value;
            await withServer(async (base) => {
                for (const res of [await get(base), await post(base, signal()), await post(base, { ...signal(), at: T0 })]) {
                    assert.deepEqual([res.status, res.json], [404, OFF], JSON.stringify(value));
                }
            });
        }
        assert.equal(supabase.calls, 0);
        assert.deepEqual(pool.queries, []);
    });

    it('the body is exactly { unitKey, chainId, seq, stop, focus, input }: a missing, extra or swapped key, a wrong type, an array or text/plain is 400 validation with the fixed text (never the value sent), after the sign-in\'s statements only', async () => {
        const { pool } = await seeded();
        const valid = signal();
        const extras = { at: 1_793_000_000_123, durationMs: 86_399_001, receivedAt: '2026-11-04T03:00:00.987Z', elapsedMs: 54_321, clientTime: 'client-clock-777' };
        const bodies = [
            ...Object.keys(valid).map((key) => [`without ${key}`, without(valid, key)]),
            ...Object.entries(extras).map(([key, value]) => [`with ${key}`, { ...valid, [key]: value }]),
            ['input swapped for clientTime (six keys)', { ...without(valid, 'input'), clientTime: extras.clientTime }],
            ...[{ seq: '1' }, { seq: 1.5 }, { seq: -1 }, { seq: 2_147_483_648 }, { stop: 'true' }, { focus: 1 }, { input: null },
                { chainId: 'chain-0001' }, { unitKey: 'Sample U1' }].map((patch) => [JSON.stringify(patch), { ...valid, ...patch }]),
            ['an array', [valid]],
        ];
        const values = ['1793000000123', '86399001', '2026-11-04T03:00:00.987Z', '54321', 'client-clock-777', '"1"', '1.5', '-1', '2147483648', '"true"', 'chain-0001', 'Sample U1'];
        const from = pool.queries.length;
        await withServer(async (base) => {
            const answers = [];
            for (const [what, body] of bodies) answers.push([what, await post(base, body)]);
            answers.push(['text/plain', await call(`${base}${SIGNALS()}`, { method: 'POST', headers: as(A), rawBody: JSON.stringify(valid), type: 'text/plain' })]);
            for (const [what, res] of answers) {
                assert.deepEqual([res.status, res.json], [400, BAD_SIGNAL], what);
                for (const value of values) assert.ok(!res.text.includes(value), `${what}: ${value} is echoed`);
            }
            assert.ok(sentSince(pool, from).every((sql) => SIGN_IN.has(sql)), 'the sign-in\'s statements only');
            assert.deepEqual(stored(pool), [0, 0, 0]);
            // The largest seq passes the body check (a chain the server does not know: not stored).
            const largest = await post(base, signal({ seq: 2_147_483_647 }));
            assert.deepEqual([largest.status, largest.json], [200, { ok: true, accepted: false, reason: 'not_open', nextInMs: null }]);
        });
    });

    it('JSON that is not an object or an array (a JSON string, null) never reaches the route: the training parser\'s 400 invalid_body, before auth (no Supabase call, no statement)', async () => {
        const { pool } = await seeded();
        const from = pool.queries.length;
        await withServer(async (base) => {
            for (const rawBody of [JSON.stringify(JSON.stringify(signal())), '"Sample U1"', 'null']) {
                const res = await call(`${base}${SIGNALS()}`, { method: 'POST', headers: as(A), rawBody });
                assert.deepEqual([res.status, res.json], [400, INVALID_BODY], rawBody);
            }
        });
        assert.equal(supabase.calls, 0);
        assert.deepEqual(sentSince(pool, from), []);
    });

    it('the cohort: an id that is not a UUID is 404 before any training statement; a missing cohort and one without the caller\'s live membership the same 404 (not told apart); an instructor 403 not_a_learner; nothing stored', async () => {
        const { pool } = await seeded();
        await withServer(async (base) => {
            const from = pool.queries.length;
            for (const id of ['web-2026-11', `${COHORT}0`, COHORT.replaceAll('-', ''), `{${COHORT}}`, '\' OR \'1\'=\'1']) {
                const cohort = encodeURIComponent(id);
                for (const res of [await get(base, { cohort }), await post(base, signal(), { cohort })]) {
                    assert.deepEqual([res.status, res.json], [404, NOT_FOUND], id);
                }
            }
            assert.ok(sentSince(pool, from).every((sql) => SIGN_IN.has(sql)), 'no training statement');
            for (const [who, user, cohort] of [['no such cohort', A, MISSING], ['in no cohort', NOBODY, COHORT], ['a marked row only', B, COHORT]]) {
                for (const res of [await get(base, { user, cohort }), await post(base, signal(), { user, cohort })]) {
                    assert.deepEqual([res.status, res.json], [404, NOT_FOUND], who);
                }
            }
            for (const res of [await get(base, { user: TEACHER }), await post(base, signal(), { user: TEACHER })]) {
                assert.deepEqual([res.status, res.json], [403, NOT_A_LEARNER]);
            }
        });
        assert.deepEqual(stored(pool), [0, 0, 0]);
        assert.ok(!pool.tx().includes('COMMIT'), 'every transaction rolled back');
    });

    it('POST accepted: 200 { ok, accepted, nextInMs: beatMs, state: { counting, reason, todayMs, unit: { unitKey, countedMs, setMs, capReached } } }, no-store, stored with the database clock; a stop: nextInMs and state null', async () => {
        const { pool } = await seeded();
        await withServer(async (base) => {
            const first = await post(base, signal());
            assert.equal(first.status, 200, first.text);
            assert.equal(first.headers.get('cache-control'), 'no-store');
            assert.deepEqual(Object.keys(first.json), ['ok', 'accepted', 'nextInMs', 'state']);
            assert.deepEqual(Object.keys(first.json.state), ['counting', 'reason', 'todayMs', 'unit']);
            assert.deepEqual(Object.keys(first.json.state.unit), ['unitKey', 'countedMs', 'setMs', 'capReached']);
            assert.deepEqual(first.json, { ok: true, accepted: true, nextInMs: BEAT, state: { counting: false, reason: 'starting', todayMs: 0, unit: { unitKey: U1, countedMs: 0, setMs: 120 * S, capReached: false } } });
            pool.setClock(T0 + 8 * S);
            const second = await post(base, signal({ seq: 1 }));
            assert.deepEqual(second.json, { ok: true, accepted: true, nextInMs: BEAT, state: { counting: true, reason: null, todayMs: 8 * S, unit: { unitKey: U1, countedMs: 8 * S, setMs: 120 * S, capReached: false } } });
            pool.setClock(T0 + 16 * S);
            const stop = await post(base, signal({ seq: 2, stop: true }));
            assert.deepEqual([stop.status, stop.json], [200, { ok: true, accepted: true, nextInMs: null, state: null }]);
            assert.equal(stop.headers.get('cache-control'), 'no-store');
        });
        assert.deepEqual(pool.state.signals.map((g) => [g.seq, g.received_at, g.flags]), [[0, T0, 6], [1, T0 + 8 * S, 6], [2, T0 + 16 * S, 7]], 'the server\'s clock; the flags of the body');
    });

    it('POST ignored: 200 { ok: true, accepted: false, reason, nextInMs }, nextInMs beatMs while the page keeps its chain (duplicate, too_soon) and null otherwise (restart, not_open, chain_ended, other_place); nothing stored', async () => {
        const { pool } = await seeded();
        const outcomes = [];
        await withServer(async (base) => {
            const accepted = async (body) => {
                const res = await post(base, body);
                assert.deepEqual([res.status, res.json?.accepted], [200, true], `${JSON.stringify(body)}: ${res.text}`);
            };
            const ignored = async (body) => {
                const before = stored(pool);
                const res = await post(base, body);
                assert.equal(res.status, 200, res.text);
                assert.deepEqual(Object.keys(res.json), ['ok', 'accepted', 'reason', 'nextInMs']);
                assert.deepEqual(stored(pool), before, `${res.json.reason}: nothing stored`);
                outcomes.push(res.json);
            };
            await accepted(signal());
            await ignored(signal()); // seq 0 again
            await ignored(signal({ seq: 1 })); // the clock has not moved since seq 0
            pool.setClock(T0 + 1 * S);
            await ignored(signal({ seq: 1 })); // 1 s after seq 0
            await ignored(signal({ chainId: chainId(2), seq: 4 })); // a chain the server does not know, after seq 0
            await ignored(signal({ chainId: chainId(3), stop: true })); // or starting with a stop
            pool.setClock(T0 + 8 * S);
            await accepted(signal({ seq: 1, stop: true }));
            pool.setClock(T0 + 16 * S);
            await ignored(signal({ seq: 2 })); // after its stop
            // Chains 4 to 7 open one second apart: three open pages newer than chain 4 (maxPlaces 3).
            for (const n of [4, 5, 6, 7]) {
                pool.setClock(T0 + (16 + n) * S);
                await accepted(signal({ chainId: chainId(n) }));
            }
            pool.setClock(T0 + 30 * S);
            await ignored(signal({ chainId: chainId(4), seq: 1 }));
        });
        const reply = (reason, nextInMs) => ({ ok: true, accepted: false, reason, nextInMs });
        assert.deepEqual(outcomes, [
            reply('duplicate', BEAT), reply('restart', null), reply('too_soon', BEAT), reply('not_open', null), reply('not_open', null),
            reply('chain_ended', null), reply('other_place', null),
        ]);
    });

    it('beatMs is the only rule value an answer carries: every 200 answer of a study session (GETs, accepted, duplicate, too_soon) has it as beatMs or nextInMs, and none has minSpacingMs, gapMs, creditCapMs, idleMs or the overlap', async () => {
        const { pool } = await seeded();
        const answers = [];
        await withServer(async (base) => {
            answers.push(await get(base));
            // One signal every 8 s: each pair counts 8 s (under creditCapMs, within gapMs), so no figure is a rule value.
            for (let seq = 0; seq <= 5; seq += 1) {
                pool.setClock(T0 + seq * 8 * S);
                answers.push(await post(base, signal({ seq })));
            }
            answers.push(await post(base, signal({ seq: 5 })));
            pool.setClock(T0 + 41 * S);
            answers.push(await post(base, signal({ seq: 6 })));
            // Unit 2 after a break longer than gapMs.
            for (let seq = 0; seq <= 2; seq += 1) {
                pool.setClock(T0 + (90 + seq * 8) * S);
                answers.push(await post(base, signal({ unitKey: U2, chainId: chainId(2), seq })));
            }
            answers.push(await get(base));
        });
        assert.deepEqual(answers.map((r) => r.json.reason ?? r.json.status ?? r.json.state.reason ?? 'counting'),
            ['ready', 'starting', 'counting', 'counting', 'counting', 'counting', 'counting', 'duplicate', 'too_soon', 'starting', 'counting', 'counting', 'ready']);
        const last = answers.at(-1).json;
        assert.deepEqual([last.units.map((u) => [u.unitKey, u.countedMs]), last.totalMs, last.days[0]], [[[U1, 40 * S], [U2, 16 * S]], 56 * S, { day: '2026-11-04', countedMs: 56 * S, final: false }]);
        for (const res of answers) {
            assert.equal(res.status, 200, res.text);
            const numbers = numbersOf(res.json);
            assert.ok(numbers.some(([key, value]) => (key === 'beatMs' || key === 'nextInMs') && value === BEAT), `beatMs in ${res.text}`);
            for (const [key, value] of numbers) {
                if (key === 'beatMs' || key === 'nextInMs') assert.equal(value, BEAT, key);
                else assert.ok(![BEAT, ...HIDDEN_MS].includes(value), `${key}: ${value} is a rule value`);
            }
            for (const value of HIDDEN) assert.ok(!res.text.includes(value), `${value} in ${res.text}`);
        }
    });

    it('409 time_not_configured, not_in_session, unit_unknown, chain_mismatch: { ok: false, error, error_type: <reason> } after the locks and one clock reading, rolled back, nothing stored', async () => {
        const outcomes = [];
        await withServer(async (base) => {
            const refused = async (pool, body, reason, options) => {
                const before = stored(pool);
                const from = pool.queries.length;
                const res = await post(base, body, options);
                assert.deepEqual([res.status, res.json], [409, { ok: false, error: REFUSED[reason], error_type: reason }], res.text);
                assert.deepEqual(sentSince(pool, from), NOT_STORED, reason);
                assert.deepEqual(stored(pool), before, `${reason}: nothing stored`);
                outcomes.push(reason);
            };
            // No setting in effect today (the first one starts later).
            await refused((await seeded({ effectiveFrom: '2026-11-10' })).pool, signal(), 'time_not_configured');
            // The cohort's last day has passed.
            await refused((await seeded({ endsOn: '2026-11-03' })).pool, signal(), 'not_in_session');
            const { pool, catalog, rules } = await seeded();
            pool.state.memberships.push({ user_id: A, cohort_id: OTHER, role: 'learner', added_at: at('2026-10-31T01:00:00Z'), account_deleted_at: null });
            pool.addSetting({ cohortId: OTHER, catalogId: catalog.id, ruleSetId: rules.id, effectiveFrom: '2026-11-01' });
            await refused(pool, signal({ unitKey: 'sample-u9' }), 'unit_unknown');
            assert.equal((await post(base, signal())).json?.accepted, true);
            pool.setClock(T0 + 8 * S);
            await refused(pool, signal({ unitKey: U2, seq: 1 }), 'chain_mismatch'); // the chain's unit is U1
            await refused(pool, signal({ seq: 1 }), 'chain_mismatch', { cohort: OTHER }); // the chain is COHORT's
            assert.deepEqual(stored(pool).slice(0, 2), [1, 1]);
        });
        assert.deepEqual(outcomes, ['time_not_configured', 'not_in_session', 'unit_unknown', 'chain_mismatch', 'chain_mismatch']);
    });

    it('401 account_deleted: a deletion that commits while the signal waits on the account lock (after the sign-in\'s reads); nothing stored', async () => {
        const { pool } = await seeded();
        pool.before(TRAINING_SQL.lock, () => pool.deleteAccount(A, T0 - 60 * S));
        const from = pool.queries.length;
        let res;
        await withServer(async (base) => {
            res = await post(base, signal());
        });
        assert.deepEqual([res.status, res.json], [401, DELETED]);
        assert.deepEqual(sentSince(pool, from), [...NOT_STORED.slice(0, -1), TRAINING_SQL.deletedAccount, 'ROLLBACK']);
        assert.deepEqual(stored(pool), [0, 0, 0]);
    });

    it('401 account_deleted for the GET too: a deletion that commits while its close waits on the account lock; nothing closed', async () => {
        const { pool } = await seeded();
        pool.before(TRAINING_SQL.lock, () => pool.deleteAccount(A, T0 - 60 * S));
        let res;
        const lines = await logged(() => withServer(async (base) => {
            res = await get(base);
        }));
        assert.deepEqual([res.status, res.json], [401, DELETED], `${res.text}\n${lines.join('\n')}`);
        assert.deepEqual(lines.filter((line) => line.startsWith('[Training]')), [], 'a deletion, not a missing account row');
        assert.deepEqual(stored(pool), [0, 0, 0]);
    });

    it('503 training_unavailable with Retry-After: 60 without a database (the sign-in then needs none)', async () => {
        setPoolForTests(null);
        await withServer(async (base) => {
            for (const res of [await get(base), await post(base, signal())]) {
                assert.deepEqual([res.status, res.json], [503, UNAVAILABLE]);
                assert.equal(res.headers.get('retry-after'), '60');
            }
        });
    });

    it('503 training_unavailable with Retry-After: 60 for a lock wait (55P03), a refused connection, a migration not applied (42P01) or a missing grant (42501); 500 training_failed for 23505; never the driver\'s text, an operation name or SQL', async () => {
        // [code, status, the statement the GET fails on, the POST's]
        const cases = [
            ['55P03', 503, TRAINING_SQL.learnerLock, TRAINING_SQL.learnerLock],
            ['ECONNREFUSED', 503, TRAINING_SQL.liveMember, TRAINING_TIME_SQL.signalState],
            ['42P01', 503, TRAINING_TIME_SQL.closeState, TRAINING_TIME_SQL.signalState],
            ['42501', 503, TRAINING_TIME_SQL.closeSettings, TRAINING_TIME_SQL.insertStream],
            ['23505', 500, TRAINING_TIME_SQL.insertDays, TRAINING_TIME_SQL.insertSignal],
        ];
        await logged(() => withServer(async (base) => {
            for (const [code, status, getSql, postSql] of cases) {
                const { pool } = await seeded();
                const error = Object.assign(new Error(`${code === '55P03' ? 'canceling statement due to lock timeout' : code} ${DRIVER}`), { code });
                for (const sql of new Set([getSql, postSql])) pool.failOn(sql, error);
                const answers = [['GET', await get(base), READ_FAILED], ['POST', await post(base, signal()), SIGNAL_FAILED]];
                for (const [what, res, failed] of answers) {
                    assert.deepEqual([res.status, res.json], [status, status === 503 ? UNAVAILABLE : failed], `${code} ${what}`);
                    assert.equal(res.headers.get('retry-after'), status === 503 ? '60' : null, `${code} ${what}`);
                    assert.doesNotMatch(res.text, LEAK, `${code} ${what}`);
                }
                const sent = sentSince(pool, 0);
                assert.ok(sent.includes(getSql) && sent.includes(postSql), `${code}: the failing statements were reached`);
                assert.deepEqual(stored(pool), [0, 0, 0], code);
            }
        }));
    });

    it('503 when the account row is gone without a tombstone (removed during the lock wait): logged with the id cut to 8 characters; nothing stored', async () => {
        const { pool } = await seeded();
        pool.before(TRAINING_SQL.lock, () => {
            pool.state.stubs = pool.state.stubs.filter((user) => user !== A);
        });
        const answers = [];
        const lines = await logged(() => withServer(async (base) => {
            answers.push(await post(base, signal()), await get(base));
        }));
        for (const res of answers) {
            assert.deepEqual([res.status, res.json], [503, UNAVAILABLE]);
            assert.equal(res.headers.get('retry-after'), '60');
        }
        // One line for both requests: the same fault of the same account is logged once a minute.
        const training = lines.filter((line) => line.startsWith('[Training]'));
        assert.equal(training.length, 1, lines.join('\n'));
        for (const line of training) assert.match(line, new RegExp(`^\\[Training\\] no account row for ${A.slice(0, 8)}…`));
        assert.ok(lines.every((line) => !line.includes(A)), 'the whole id is never logged');
        assert.deepEqual(stored(pool), [0, 0, 0]);
    });

    it('503 when the database clock is behind a closed day (inside its evidence window): logged, nothing stored', async () => {
        const { pool } = await seeded();
        let res;
        const lines = await logged(() => withServer(async (base) => {
            assert.equal((await get(base)).status, 200, 'closes 11-01 … 11-03 at 12:00 JST on 11-04');
            pool.setClock(jstDayRange('2026-11-04').start + 5 * S); // 00:00:05 JST: 11-03's end + gapMs has not passed
            res = await post(base, signal());
        }));
        assert.deepEqual([res.status, res.json], [503, UNAVAILABLE]);
        assert.equal(res.headers.get('retry-after'), '60');
        const training = lines.filter((line) => line.startsWith('[Training]'));
        assert.equal(training.length, 1, lines.join('\n'));
        assert.match(training[0], /clock is behind a closed day/);
        assert.deepEqual(stored(pool), [0, 0, 3]);
    });

    it('500 training_failed (no Retry-After) when a stored rules version no longer parses with this code; nothing stored', async () => {
        const { pool } = await seeded();
        pool.state.rules[0].params.counting.gapMs = 1;
        await withServer(async (base) => {
            const read = await get(base);
            const sent = await post(base, signal());
            assert.deepEqual([read.status, read.json], [500, READ_FAILED]);
            assert.deepEqual([sent.status, sent.json], [500, SIGNAL_FAILED]);
            for (const res of [read, sent]) {
                assert.equal(res.headers.get('retry-after'), null);
                assert.doesNotMatch(res.text, LEAK);
            }
        });
        assert.deepEqual(stored(pool), [0, 0, 0]);
    });

    it('a failure after the signal is stored keeps it: 200 accepted with state null; the close\'s and the state\'s failures logged by their type only', async () => {
        const { pool } = await seeded();
        pool.failOn(TRAINING_TIME_SQL.insertDays, Object.assign(new Error(`23505 ${DRIVER}`), { code: '23505' }));
        pool.failOn(TRAINING_TIME_SQL.currentDays, Object.assign(new Error(`42P01 ${DRIVER}`), { code: '42P01' }));
        let res;
        const lines = await logged(() => withServer(async (base) => {
            res = await post(base, signal());
        }));
        assert.deepEqual([res.status, res.json], [200, { ok: true, accepted: true, nextInMs: BEAT, state: null }]);
        assert.deepEqual(lines.filter((line) => line.startsWith('[Training]')), [
            '[Training] closing days after a signal failed (conflict)',
            '[Training] study time state failed (table_not_found)',
        ]);
        assert.deepEqual(stored(pool), [1, 1, 0], 'the signal stays; the close rolled back');
    });

    it('GET: 200 with its keys in order and the ids in lower case, no-store; beatMs only while ready (none when not_configured or not_in_session)', async () => {
        const KEYS = ['ok', 'learnerId', 'cohortId', 'today', 'timeZone', 'status', 'beatMs', 'units', 'days', 'totalMs', 'asOf'];
        await seeded();
        await withServer(async (base) => {
            const ready = await get(base, { user: A.toUpperCase(), cohort: COHORT.toUpperCase() });
            assert.equal(ready.status, 200, ready.text);
            assert.equal(ready.headers.get('cache-control'), 'no-store');
            assert.deepEqual(Object.keys(ready.json), KEYS);
            assert.deepEqual(ready.json, {
                ok: true,
                learnerId: A,
                cohortId: COHORT,
                today: '2026-11-04',
                timeZone: 'Asia/Tokyo',
                status: 'ready',
                beatMs: BEAT,
                units: COURSE.units.map((u) => ({ unitKey: u.key, title: u.title, setMs: u.setMinutes * 60 * S, countedMs: 0, capReached: false })),
                days: [
                    { day: '2026-11-04', countedMs: 0, final: false },
                    { day: '2026-11-03', countedMs: 0, final: true },
                    { day: '2026-11-02', countedMs: 0, final: true },
                    { day: '2026-11-01', countedMs: 0, final: true },
                ],
                totalMs: 0,
                asOf: '2026-11-04T03:00:00.000Z',
            });
            for (const [what, options, status] of [
                ['no setting', { setting: false }, 'not_configured'],
                ['the first setting from a later day', { effectiveFrom: '2026-11-10' }, 'not_configured'],
                ['the last day passed', { endsOn: '2026-11-03' }, 'not_in_session'],
                ['no last day', { endsOn: null }, 'not_in_session'],
            ]) {
                await seeded(options);
                const res = await get(base);
                assert.deepEqual([res.status, res.json?.status], [200, status], `${what}: ${res.text}`);
                assert.deepEqual(Object.keys(res.json), KEYS.filter((key) => key !== 'beatMs'), what);
                assert.ok(!res.text.includes(String(BEAT)), what);
            }
        });
    });

    it(`the per-learner limit counts these routes together with GET /me: the ${TRAINING_REQUESTS_PER_MINUTE + 1}st request in a minute, any mix, is 429 rate_limited before any training statement; another learner is unaffected`, async () => {
        assert.equal(TRAINING_REQUESTS_PER_MINUTE, 60);
        const { pool } = await seeded();
        // helpers/trainingTimePool.js answers study time, not GET /me's statement: /me reads helpers/trainingPool.js.
        const mePool = createTrainingPool({ cohorts: [{ id: COHORT, name: 'Web', starts_on: '2026-11-01' }], memberships: [{ cohort_id: COHORT, user_id: A, role: 'learner' }] });
        const me = async (base, user = A) => {
            setPoolForTests(mePool);
            try {
                return await call(`${base}${ME}`, { headers: as(user) });
            } finally {
                setPoolForTests(pool);
            }
        };
        await withServer(async (base) => {
            const routes = [() => me(base), () => get(base), () => post(base, signal())];
            for (let i = 0; i < TRAINING_REQUESTS_PER_MINUTE; i += 1) {
                const res = await routes[i % routes.length]();
                assert.equal(res.status, 200, `${i + 1}: ${res.text.slice(0, 120)}`);
            }
            const from = pool.queries.length;
            for (const route of [...routes].reverse()) {
                const limited = await route();
                assert.deepEqual([limited.status, limited.json], [429, RATE_LIMITED]);
            }
            assert.ok(sentSince(pool, from).every((sql) => SIGN_IN.has(sql)), 'refused before any training statement');
            assert.equal((await me(base, B)).status, 200, 'another learner');
        });
    });
});
