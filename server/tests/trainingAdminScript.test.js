// The staff script for job-training cohorts (scripts/training-admin.mjs) and the logic it calls
// (tools/core/training.js createCohort, addMember, listMembers), with a fake database that answers
// only the module's statements:
// - nothing happens unless TRAINING_ENABLED is exactly "true" (the public stack leaves it unset);
// - a member is added under the account's shared lock and then the learner's training lock (each
//   its own statement), only while the auth.users stub exists, with the default added_at; one live
//   row per cohort and account; a learner already in a cohort whose dates overlap is refused;
// - every other outcome (already, another role, no cohort, a deleted account, no account yet, a
//   busy lock, a database error) rolls back and has its exit code;
// - the list shows marked rows too (deleted accounts, training-plan D3).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT, parseArgs, run } from '../../scripts/training-admin.mjs';
import { PHASE1_USER_ID } from '../db.js';
import { accountLockKey } from '../../tools/core/accountDeletions.js';
import { TRAINING_ROLES, TRAINING_SQL, addMember, isCalendarDate } from '../../tools/core/training.js';

const A = 'aaaaaaaa-2121-4000-8000-0000000000a1';
const B = 'aaaaaaaa-2121-4000-8000-0000000000b2';
const GONE = 'aaaaaaaa-2121-4000-8000-0000000000d0';
const NEVER = 'aaaaaaaa-2121-4000-8000-0000000000e0';
const COHORT = 'c0000000-0000-4000-8000-000000000001';
const ON = { TRAINING_ENABLED: 'true' };

/**
 * A fake database: cohorts by slug, auth.users stubs, tombstones and memberships.
 * @param {{ stubs?: string[], tombstones?: string[], cohorts?: any[], memberships?: any[] }} [seed]
 */
function fakePool(seed = {}) {
    const state = {
        stubs: new Set(seed.stubs ?? [A, B]),
        tombstones: new Set(seed.tombstones ?? [GONE]),
        cohorts: (seed.cohorts ?? [{ id: COHORT, slug: 'web-2026-11', name: 'Web', starts_on: '2026-11-01', ends_on: '2027-01-31' }]).map((c) => ({ ...c })),
        memberships: (seed.memberships ?? []).map((m) => ({ account_deleted_at: null, added_at: new Date('2026-10-29T00:00:00Z'), ...m })),
        /** @type {{ sql: string, params: unknown[], tx: boolean }[]} */
        queries: [],
        /** @type {{ match: string, error: any } | null} */
        failure: null,
        connectError: null,
        releases: [],
    };
    const answer = (/** @type {boolean} */ tx) => async (/** @type {string} */ sql, /** @type {any[]} */ params = []) => {
        state.queries.push({ sql, params, tx });
        if (state.failure && sql === state.failure.match) throw state.failure.error;
        switch (sql) {
            case 'BEGIN': case 'COMMIT': case 'ROLLBACK': case TRAINING_SQL.lockTimeout: case TRAINING_SQL.lock: case TRAINING_SQL.learnerLock:
                return { rowCount: 0, rows: [] };
            case TRAINING_SQL.overlapping: {
                // As the SQL: live learner rows in another cohort; a cohort without both dates overlaps nothing.
                const [userId, cohortId] = params;
                const target = state.cohorts.find((c) => c.id === cohortId);
                const rows = state.memberships
                    .filter((m) => m.user_id === userId && m.role === 'learner' && m.account_deleted_at === null && m.cohort_id !== cohortId)
                    .map((m) => state.cohorts.find((c) => c.id === m.cohort_id))
                    .filter((o) => o && target && o.starts_on && o.ends_on && target.starts_on && target.ends_on && o.starts_on <= target.ends_on && target.starts_on <= o.ends_on)
                    .sort((x, y) => (x.starts_on + x.slug).localeCompare(y.starts_on + y.slug))
                    .slice(0, 1)
                    .map((o) => ({ slug: o.slug }));
                return { rowCount: rows.length, rows };
            }
            case TRAINING_SQL.cohortBySlug: {
                const rows = state.cohorts.filter((c) => c.slug === params[0]);
                return { rowCount: rows.length, rows };
            }
            case TRAINING_SQL.createCohort: {
                if (state.cohorts.some((c) => c.slug === params[0])) return { rowCount: 0, rows: [] };
                const id = `c0000000-0000-4000-8000-00000000000${state.cohorts.length + 1}`;
                state.cohorts.push({ id, slug: params[0], name: params[1], starts_on: params[2], ends_on: params[3] });
                return { rowCount: 1, rows: [{ id }] };
            }
            case TRAINING_SQL.addMember: {
                const [userId, cohortId, role] = params;
                if (!state.stubs.has(userId)) return { rowCount: 0, rows: [] };
                if (state.memberships.some((m) => m.user_id === userId && m.cohort_id === cohortId && m.account_deleted_at === null)) return { rowCount: 0, rows: [] };
                state.memberships.push({ user_id: userId, cohort_id: cohortId, role, added_at: new Date('2026-10-29T01:00:00Z'), account_deleted_at: null });
                return { rowCount: 1, rows: [{ id: 'm1' }] };
            }
            case TRAINING_SQL.liveMember: {
                const rows = state.memberships.filter((m) => m.user_id === params[0] && m.cohort_id === params[1] && m.account_deleted_at === null).map((m) => ({ role: m.role }));
                return { rowCount: rows.length, rows };
            }
            case TRAINING_SQL.deletedAccount:
                return state.tombstones.has(params[0]) ? { rowCount: 1, rows: [{ '?column?': 1 }] } : { rowCount: 0, rows: [] };
            case TRAINING_SQL.members: {
                const rows = state.memberships.filter((m) => m.cohort_id === params[0]).map((m) => ({ ...m }));
                return { rowCount: rows.length, rows };
            }
            default:
                throw new Error(`fakePool: unexpected statement: ${sql}`);
        }
    };
    const pool = {
        state,
        query: answer(false),
        connect: async () => {
            if (state.connectError) throw state.connectError;
            return { query: answer(true), release: (/** @type {unknown} */ broken) => state.releases.push(broken) };
        },
        /** The statements sent on the transaction's client, in order. */
        tx: () => state.queries.filter((q) => q.tx).map((q) => q.sql),
    };
    return pool;
}

const runWith = async (argv, { pool = fakePool(), env = ON } = {}) => {
    const lines = [];
    const code = await run(argv, { getPool: () => /** @type {any} */ (pool), env, log: (line) => lines.push(line) });
    return { code, out: lines.join('\n'), pool };
};

describe('scripts/training-admin.mjs: the switch and the arguments', () => {
    it('refuses everything unless TRAINING_ENABLED is exactly "true" (exit 2), before any statement', async () => {
        for (const env of [{}, { TRAINING_ENABLED: '' }, { TRAINING_ENABLED: 'TRUE' }, { TRAINING_ENABLED: '1' }, { TRAINING_ENABLED: 'yes' }]) {
            for (const argv of [['--list', 'web-2026-11'], ['--add', A, '--cohort', 'web-2026-11', '--role', 'learner'], ['--create-cohort', 'x', '--name', 'X']]) {
                const { code, out, pool } = await runWith(argv, { env });
                assert.equal(code, EXIT.refused, JSON.stringify(env));
                assert.match(out, /TRAINING_ENABLED is not "true"/);
                assert.deepEqual(pool.state.queries, []);
            }
        }
    });

    it('usage errors (exit 1) send nothing', async () => {
        for (const argv of [[], ['--list'], ['--list', 'a', '--add', A], ['--create-cohort', 'x'], ['--add', A, '--cohort', 'web-2026-11'],
            ['--name', 'X', '--list', 'a'], ['--cohort', 'a', '--list', 'a'], ['--bogus'], ['--add', 'not-a-uuid', '--cohort', 'a', '--role', 'learner'],
            ['--add', PHASE1_USER_ID, '--cohort', 'web-2026-11', '--role', 'learner'], ['--add', A, '--cohort', 'web-2026-11', '--role', 'admin'],
            ['--create-cohort', 'Bad Slug', '--name', 'X'], ['--create-cohort', 'ok', '--name', 'X', '--starts-on', '2026-02-30'],
            ['--create-cohort', 'ok', '--name', 'X', '--starts-on', '2026-12-01', '--ends-on', '2026-11-01'], ['--create-cohort', 'ok', '--name', '  '],
            ['--create-cohort', 'ok', '--name', 'X', '--starts-on', '0000-01-01']]) {
            const { code, pool } = await runWith(argv);
            assert.equal(code, EXIT.usage, argv.join(' '));
            assert.deepEqual(pool.state.queries, [], argv.join(' '));
        }
        assert.equal(parseArgs(['--help']).help, true);
        assert.equal((await runWith(['--help'])).code, EXIT.ok);
        assert.deepEqual([...TRAINING_ROLES], ['learner', 'instructor', 'examiner', 'staff']);
        assert.equal(isCalendarDate('2026-02-28'), true);
        assert.equal(isCalendarDate('2026-02-29'), false);
        assert.equal(isCalendarDate('0000-01-01'), false, 'PostgreSQL has no year 0 (22008 would read as an outage)');
        assert.equal(isCalendarDate('0001-01-01'), true);
    });
});

describe('scripts/training-admin.mjs: cohorts', () => {
    it('--create-cohort creates once; again it is left as it is (exit 0 both times)', async () => {
        const pool = fakePool({ cohorts: [] });
        const first = await runWith(['--create-cohort', 'web-2026-11', '--name', '2026年11月 Web', '--starts-on', '2026-11-01', '--ends-on', '2027-01-31'], { pool });
        assert.equal(first.code, EXIT.ok);
        assert.match(first.out, /^Created cohort web-2026-11 \(c0000000-0000-4000-8000-000000000001\): 2026年11月 Web, 2026-11-01 … 2027-01-31$/);
        const again = await runWith(['--create-cohort', 'web-2026-11', '--name', 'Other name'], { pool });
        assert.equal(again.code, EXIT.ok);
        assert.match(again.out, /already exists .* 2026年11月 Web, .* Left as it is\.$/);
        assert.equal(pool.state.cohorts.length, 1);
        assert.ok(pool.state.queries.every((q) => !q.tx), 'no transaction for a cohort');
    });

    it('--list shows every membership, a deleted account\'s marked row too; an unknown cohort is refused', async () => {
        const pool = fakePool({
            memberships: [
                { user_id: A, cohort_id: COHORT, role: 'learner' },
                { user_id: GONE, cohort_id: COHORT, role: 'learner', account_deleted_at: new Date('2026-10-20T00:00:00Z') },
                { user_id: B, cohort_id: COHORT, role: 'instructor' },
            ],
        });
        const { code, out } = await runWith(['--list', 'web-2026-11'], { pool });
        assert.equal(code, EXIT.ok);
        const lines = out.split('\n');
        assert.equal(lines[0], `web-2026-11 (${COHORT}): Web, 2026-11-01 … 2027-01-31, 3 membership(s)`);
        assert.match(lines[1], new RegExp(`^${A}  learner {3}  added 2026-10-29T00:00:00.000Z$`));
        assert.match(lines[2], new RegExp(`^${GONE}  learner {3}  added .*  account deleted 2026-10-20T00:00:00.000Z$`));
        assert.match(lines[3], new RegExp(`^${B}  instructor  added `));
        assert.equal((await runWith(['--list', 'nope'], { pool })).code, EXIT.refused);
    });
});

describe('scripts/training-admin.mjs: adding a member', () => {
    it('added under the shared account lock, then the learner lock (each its own statement), the overlap check, then the INSERT; the id in canonical form; COMMIT', async () => {
        const { code, out, pool } = await runWith(['--add', A.toUpperCase(), '--cohort', 'web-2026-11', '--role', 'learner']);
        assert.equal(code, EXIT.ok);
        assert.equal(out, `Added ${A} to web-2026-11 as learner.`);
        assert.deepEqual(pool.tx(), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_SQL.overlapping, TRAINING_SQL.addMember, 'COMMIT']);
        const insert = pool.state.queries.find((q) => q.sql === TRAINING_SQL.addMember);
        assert.deepEqual(insert?.params, [A, COHORT, 'learner']);
        assert.deepEqual(pool.state.queries.find((q) => q.sql === TRAINING_SQL.lock)?.params, [A]);
        assert.deepEqual(pool.state.queries.find((q) => q.sql === TRAINING_SQL.learnerLock)?.params, [A]);
        assert.deepEqual(pool.state.queries.find((q) => q.sql === TRAINING_SQL.overlapping)?.params, [A, COHORT]);
        assert.deepEqual(pool.state.releases, [false]);
        // Another role: no overlap check (one moment counts twice only for a learner).
        const staff = await runWith(['--add', B, '--cohort', 'web-2026-11', '--role', 'instructor']);
        assert.deepEqual(staff.pool.tx(), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_SQL.addMember, 'COMMIT']);
    });

    it('a learner in another cohort whose dates overlap is refused (exit 2, rolled back); a cohort after it, another role, a cohort without dates and the same cohort again are fine', async () => {
        const OVERLAP = 'c0000000-0000-4000-8000-000000000002';
        const LATER = 'c0000000-0000-4000-8000-000000000003';
        const UNDATED = 'c0000000-0000-4000-8000-000000000004';
        const pool = fakePool({
            cohorts: [
                { id: COHORT, slug: 'web-2026-11', name: 'Web', starts_on: '2026-11-01', ends_on: '2027-01-31' },
                { id: OVERLAP, slug: 'web-2027-01', name: 'Web 2', starts_on: '2027-01-31', ends_on: '2027-04-30' },
                { id: LATER, slug: 'web-2027-02', name: 'Web 3', starts_on: '2027-02-01', ends_on: '2027-04-30' },
                { id: UNDATED, slug: 'draft', name: 'Draft', starts_on: null, ends_on: null },
            ],
            memberships: [{ user_id: A, cohort_id: COHORT, role: 'learner' }],
        });
        const refused = await runWith(['--add', A, '--cohort', 'web-2027-01', '--role', 'learner'], { pool });
        assert.equal(refused.code, EXIT.refused);
        assert.equal(refused.out, `Refused: ${A} is a learner in web-2026-11, whose dates overlap web-2027-01's; a learner is in one cohort at a time.`);
        assert.deepEqual(pool.tx().slice(-4), [TRAINING_SQL.learnerLock, TRAINING_SQL.overlapping, TRAINING_SQL.liveMember, 'ROLLBACK'], 'no INSERT');
        assert.equal((await runWith(['--add', A, '--cohort', 'web-2027-02', '--role', 'learner'], { pool })).code, EXIT.ok, 'the day after the last day');
        assert.equal((await runWith(['--add', A, '--cohort', 'draft', '--role', 'learner'], { pool })).code, EXIT.ok, 'a cohort without dates counts nothing');
        assert.equal((await runWith(['--add', A, '--cohort', 'web-2027-01', '--role', 'examiner'], { pool })).code, EXIT.ok, 'another role');
        const again = await runWith(['--add', A, '--cohort', 'web-2026-11', '--role', 'learner'], { pool });
        assert.deepEqual([again.code, again.out], [EXIT.ok, `${A} is already in web-2026-11 as learner.`], 'its own cohort is not an overlap');
        // A marked (deleted account's) membership overlaps nothing.
        const marked = fakePool({ memberships: [{ user_id: B, cohort_id: COHORT, role: 'learner', account_deleted_at: new Date('2026-10-20T00:00:00Z') }] });
        marked.state.cohorts.push({ id: OVERLAP, slug: 'web-2027-01', name: 'Web 2', starts_on: '2027-01-31', ends_on: '2027-04-30' });
        assert.equal((await runWith(['--add', B, '--cohort', 'web-2027-01', '--role', 'learner'], { pool: marked })).code, EXIT.ok);
    });

    it('already in the cohort: the same role is fine (exit 0), another role is refused (exit 2); both roll back', async () => {
        const pool = fakePool({ memberships: [{ user_id: A, cohort_id: COHORT, role: 'learner' }] });
        const same = await runWith(['--add', A, '--cohort', 'web-2026-11', '--role', 'learner'], { pool });
        assert.deepEqual([same.code, same.out], [EXIT.ok, `${A} is already in web-2026-11 as learner.`]);
        const other = await runWith(['--add', A, '--cohort', 'web-2026-11', '--role', 'staff'], { pool });
        assert.equal(other.code, EXIT.refused);
        assert.match(other.out, /already in web-2026-11 as learner; changing a role is not supported yet/);
        assert.equal(pool.state.memberships.length, 1);
        assert.equal(pool.tx().filter((s) => s === 'COMMIT').length, 0);
        assert.equal(pool.tx().filter((s) => s === 'ROLLBACK').length, 2);
    });

    it('refused (exit 2): no cohort (no transaction), a deleted account, an account that never signed in here', async () => {
        const noCohort = await runWith(['--add', A, '--cohort', 'nope', '--role', 'learner']);
        assert.equal(noCohort.code, EXIT.refused);
        assert.match(noCohort.out, /no cohort nope/);
        assert.deepEqual(noCohort.pool.tx(), []);
        const gone = await runWith(['--add', GONE, '--cohort', 'web-2026-11', '--role', 'learner']);
        assert.equal(gone.code, EXIT.refused);
        assert.match(gone.out, /was deleted/);
        assert.deepEqual(gone.pool.tx(), ['BEGIN', TRAINING_SQL.lockTimeout, TRAINING_SQL.lock, TRAINING_SQL.learnerLock, TRAINING_SQL.overlapping, TRAINING_SQL.addMember, TRAINING_SQL.liveMember, TRAINING_SQL.deletedAccount, 'ROLLBACK']);
        const never = await runWith(['--add', NEVER, '--cohort', 'web-2026-11', '--role', 'learner']);
        assert.equal(never.code, EXIT.refused);
        assert.match(never.out, /no Rise Path account .* signs in to this school's app once/);
        assert.equal(never.pool.state.memberships.length, 0);
    });

    it('unavailable (exit 3): a busy account lock (55P03) says so; a database error and no database too; never the driver\'s text', async () => {
        const busy = fakePool();
        busy.state.failure = { match: TRAINING_SQL.lock, error: Object.assign(new Error('canceling statement due to lock timeout (host db.internal)'), { code: '55P03' }) };
        const a = await runWith(['--add', A, '--cohort', 'web-2026-11', '--role', 'learner'], { pool: busy });
        assert.equal(a.code, EXIT.unavailable);
        assert.match(a.out, /the account is busy/);
        assert.equal(busy.tx().at(-1), 'ROLLBACK');
        const down = fakePool();
        down.state.connectError = Object.assign(new Error('connect ECONNREFUSED db.internal:5432'), { code: 'ECONNREFUSED' });
        const b = await runWith(['--add', A, '--cohort', 'web-2026-11', '--role', 'learner'], { pool: down });
        assert.equal(b.code, EXIT.unavailable);
        assert.doesNotMatch(b.out, /db\.internal|ECONNREFUSED/);
        const none = await runWith(['--list', 'web-2026-11'], { pool: /** @type {any} */ (null) });
        assert.equal(none.code, EXIT.unavailable);
    });
});

describe('tools/core/training.js: the staff statements', () => {
    it('addMember refuses the shared dev and bridge user itself, before any statement (not only the script)', async () => {
        const pool = fakePool({ stubs: [PHASE1_USER_ID] });
        const result = await addMember({ cohortSlug: 'web-2026-11', userId: PHASE1_USER_ID.toUpperCase(), role: 'learner', pool: /** @type {any} */ (pool) });
        assert.equal(result.error_type, 'validation');
        assert.deepEqual(pool.state.queries, []);
    });

    it('the lock is the shared account lock; the learner lock is exclusive and per account; the INSERT needs the stub, uses the live-only conflict target and the default added_at', () => {
        assert.equal(TRAINING_SQL.lock, `SELECT pg_advisory_xact_lock_shared(${accountLockKey(1)})`);
        assert.equal(TRAINING_SQL.learnerLock, "SELECT pg_advisory_xact_lock(hashtextextended('rp:training:' || $1::uuid::text, 0))");
        assert.match(TRAINING_SQL.overlapping, /m\.role = 'learner' AND m\.account_deleted_at IS NULL AND o\.id <> c\.id/);
        assert.match(TRAINING_SQL.overlapping, /o\.starts_on <= c\.ends_on AND c\.starts_on <= o\.ends_on/, 'NULL dates compare to NULL: no overlap');
        assert.match(TRAINING_SQL.addMember, /WHERE EXISTS \(SELECT 1 FROM auth\.users WHERE id = \$1::uuid\)/);
        assert.match(TRAINING_SQL.addMember, /ON CONFLICT \(cohort_id, user_id\) WHERE account_deleted_at IS NULL DO NOTHING/);
        assert.doesNotMatch(TRAINING_SQL.addMember, /added_at/, 'added_at is the default, never sent (the deletion mark must not be earlier)');
        assert.match(TRAINING_SQL.me, /m\.account_deleted_at IS NULL/, 'the learner sees live rows only');
        assert.doesNotMatch(TRAINING_SQL.members, /account_deleted_at IS NULL/, 'the staff list keeps marked rows');
        assert.match(TRAINING_SQL.lockTimeout, /^SET LOCAL lock_timeout = '10s'$/);
        // A DATE read as a JS Date is local midnight: east of UTC it would print the day before.
        assert.match(TRAINING_SQL.cohortBySlug, /to_char\(starts_on, 'YYYY-MM-DD'\) AS starts_on, to_char\(ends_on, 'YYYY-MM-DD'\) AS ends_on/);
    });
});
