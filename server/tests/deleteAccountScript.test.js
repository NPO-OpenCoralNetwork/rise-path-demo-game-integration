// The staff script (Phase 4, scripts/delete-account-data.mjs) through its testable run(argv, deps)
// with fakes: no child process, no database, no Supabase. Usage refusals, the canonical id, the
// service key requirement (never the anon key), the orphan rules (only a 404 / user_not_found is an
// orphan; any other answer stops the run; a wrong project is refused) and the exit codes.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHASE1_USER_ID } from '../db.js';
import { DRY_RUN_TABLES, EXIT, ORPHAN_PAGE, STUB_PAGE_SQL, defaultDeps, parseArgs, run } from '../../scripts/delete-account-data.mjs';

const A = 'abcdef01-2345-4678-9abc-def012345678';
const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
const uuid = (n) => `abcd${n.toString(16).padStart(4, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** Fakes for run(): records service calls and log lines. */
function makeDeps({ result = { status: 'deleted', deletedAt: '2026-10-24T05:00:00.000Z' }, admin = null, pool = null } = {}) {
    const calls = [];
    const lines = [];
    return {
        calls,
        lines,
        deps: {
            deleteAccountData: async (input) => {
                calls.push(input);
                return typeof result === 'function' ? result(input) : result;
            },
            readDeletionState: async () => ({ subscription: 'none' }),
            createAdminClient: async () => admin,
            getPool: () => pool,
            readBillingDeps: () => ({ config: { live: false }, stripe: null }),
            log: (line) => lines.push(line),
            now: () => Date.parse('2026-10-24T05:00:00Z'),
        },
    };
}

/**
 * A pool whose auth.users holds `ids`, kept in reverse order (a heap has no order of its own). It
 * reads the statement the script sends: the PHASE1 exclusion (`id <> $2::uuid`), `ORDER BY id`
 * and `LIMIT` apply only when the SQL has them, so a statement that drops one changes the answer.
 * ignoreExclusion: return PHASE1 even when the SQL excludes it (the script's own skip on its own).
 * @param {string[]} ids @param {{ ignoreExclusion?: boolean }} [options]
 */
function stubPool(ids, { ignoreExclusion = false } = {}) {
    const heap = [...ids].sort().reverse();
    const queries = [];
    return {
        queries,
        query: async (sql, params) => {
            const text = norm(sql);
            queries.push({ sql: text, params });
            const m = /^select id from auth\.users where id > \$1::uuid( and id <> \$2::uuid)?( order by id)?( limit (\d+))?$/.exec(text);
            if (!m) throw new Error(`unexpected ${sql}`);
            const [after, phase1] = params;
            let rows = heap.filter((id) => id > after && (ignoreExclusion || !m[1] || id !== phase1));
            if (m[2]) rows.sort();
            if (m[3]) rows = rows.slice(0, Number(m[4]));
            return { rowCount: rows.length, rows: rows.map((id) => ({ id })) };
        },
    };
}

/** Supabase's admin API: `known` exist; others answer `missing` (default: 404 user_not_found). */
function adminWith(known, { missing = () => ({ data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } }) } = {}) {
    const lookups = [];
    return {
        lookups,
        auth: {
            admin: {
                getUserById: async (id) => {
                    lookups.push(id);
                    return known.has(id) ? { data: { user: { id } }, error: null } : missing(id);
                },
                listUsers: async ({ page, perPage }) => {
                    const users = [...known].map((id, i) => ({ id, email: i === 1 ? 'Someone@Example.com' : `user${i}@example.org`, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: null }));
                    return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null };
                },
            },
        },
    };
}

describe('scripts/delete-account-data.mjs: usage and --user', () => {
    it('parseArgs: exactly one mode; --user needs --dry-run or --yes; --limit bounds', () => {
        assert.match(parseArgs([]).error, /exactly one/);
        assert.match(parseArgs(['--user', A]).error, /--dry-run or --yes/);
        assert.match(parseArgs(['--user', A, '--dry-run', '--yes']).error, /--dry-run or --yes/);
        assert.match(parseArgs(['--user']).error, /needs a value/);
        assert.match(parseArgs(['--orphans', '--limit', '0']).error, /--limit/);
        assert.match(parseArgs(['--orphans', '--limit', '5x']).error, /--limit/);
        assert.match(parseArgs(['--find-email', 'a@b.c', '--yes']).error, /deletes nothing/);
        assert.match(parseArgs(['--user', A, '--yes', '--force']).error, /unknown argument --force/);
        assert.equal(parseArgs(['--orphans', '--limit', '20']).limit, 20);
        assert.equal(parseArgs(['--orphans']).limit, 500);
    });

    it('refuses without --yes (and without --dry-run): exit 1, nothing deleted', async () => {
        const { deps, calls, lines } = makeDeps();
        assert.equal(await run(['--user', A], deps), EXIT.usage);
        assert.equal(calls.length, 0);
        assert.match(lines.join('\n'), /Usage:/);
    });

    it('refuses PHASE1_USER_ID (any case) and non-UUIDs before anything', async () => {
        for (const id of [PHASE1_USER_ID, PHASE1_USER_ID.toUpperCase(), 'someone@example.com', `${A}x`, '1']) {
            const { deps, calls } = makeDeps();
            assert.equal(await run(['--user', id, '--yes'], deps), EXIT.usage, id);
            assert.equal(calls.length, 0, id);
        }
    });

    it('--user with an upper-case id calls the service with the lower-case id, requestedBy staff, authTime null', async () => {
        const { deps, calls, lines } = makeDeps();
        assert.equal(await run(['--user', A.toUpperCase(), '--yes'], deps), EXIT.ok);
        assert.deepEqual(calls, [{ userId: A, requestedBy: 'staff', authTime: null, billing: { config: { live: false }, stripe: null } }]);
        assert.deepEqual(JSON.parse(lines.at(-1)), { userId: A, status: 'deleted', deletedAt: '2026-10-24T05:00:00.000Z' });
    });

    it('works whatever ACCOUNT_DELETION_ENABLED says (the switch is for the Settings page only and starts off)', async () => {
        const saved = process.env.ACCOUNT_DELETION_ENABLED;
        try {
            for (const value of [undefined, '', 'false', 'true', 'flase']) {
                if (value === undefined) delete process.env.ACCOUNT_DELETION_ENABLED;
                else process.env.ACCOUNT_DELETION_ENABLED = value;
                const { deps, calls } = makeDeps();
                assert.equal(await run(['--user', A, '--yes'], deps), EXIT.ok, JSON.stringify(value));
                assert.equal(calls.length, 1, JSON.stringify(value));
            }
        } finally {
            if (saved === undefined) delete process.env.ACCOUNT_DELETION_ENABLED;
            else process.env.ACCOUNT_DELETION_ENABLED = saved;
        }
        for (const file of ['../../scripts/delete-account-data.mjs', '../services/accountDeletion.js']) {
            const source = readFileSync(new URL(file, import.meta.url), 'utf8');
            assert.doesNotMatch(source, /env\.ACCOUNT_DELETION_ENABLED|readDeletionSwitch|from '[^']*routes\/account/, `${file} never reads the switch`);
        }
    });

    it('exit codes: already 0, a refusal 2 (a renewing plan), Stripe or Memanto down 3 (as the API\'s 503), failed 3', async () => {
        for (const [result, code] of [
            [{ status: 'already', deletedAt: null }, EXIT.ok],
            [{ status: 'refused', reason: 'subscription_active', memoryDeleted: false }, EXIT.refused],
            [{ status: 'refused', reason: 'subscription_active', memoryDeleted: true }, EXIT.refused],
            [{ status: 'refused', reason: 'invalid_user', memoryDeleted: false }, EXIT.refused],
            [{ status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false }, EXIT.unavailable],
            [{ status: 'refused', reason: 'memory_service_unavailable', memoryDeleted: false }, EXIT.unavailable],
            [{ status: 'failed', reason: 'account_busy', memoryDeleted: true }, EXIT.unavailable],
        ]) {
            const { deps } = makeDeps({ result });
            assert.equal(await run(['--user', A, '--yes'], deps), code, JSON.stringify(result));
        }
    });

    it('--dry-run counts rows per table, says whether a renewing plan blocks, and deletes nothing', async () => {
        const queries = [];
        const pool = {
            query: async (sql, params) => {
                queries.push({ sql: norm(sql), params });
                if (norm(sql).startsWith('select deleted_at, reopened_at, requested_by from account_deletions')) return { rows: [] };
                if (norm(sql).startsWith('select count(*)::int as n from legal_acceptances')) throw Object.assign(new Error('missing'), { code: '42P01' });
                return { rows: [{ n: 2 }] };
            },
        };
        const { deps, calls, lines } = makeDeps({ pool });
        const asked = [];
        deps.readDeletionState = async (input) => {
            asked.push(input);
            return { subscription: 'renewing' };
        };
        assert.equal(await run(['--user', A.toUpperCase(), '--dry-run'], deps), EXIT.ok);
        assert.equal(calls.length, 0);
        // The plan rows as the deletion counts them: the billing deps decide whether test-mode rows count.
        assert.deepEqual(asked, [{ pool, userId: A, billing: { config: { live: false }, stripe: null } }]);
        assert.ok(queries.every((q) => q.params[0] === A && !/^(delete|update|insert)/.test(q.sql)));
        for (const table of DRY_RUN_TABLES) assert.ok(lines.some((l) => l.startsWith(`  ${table}: `)), table);
        assert.ok(lines.includes('  legal_acceptances: missing table'));
        assert.ok(lines.some((l) => l.includes('renewing supporter plan blocks the deletion')));
        assert.equal(lines[0], `Account ${A} (dry run: nothing is deleted)`, 'the full id goes to the staff terminal');
    });
});

describe('scripts/delete-account-data.mjs: --find-email and --orphans need the service key', () => {
    const saved = {};
    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it('without a service-role client both refuse (exit 1) and touch nothing', async () => {
        for (const argv of [['--find-email', 'someone@example.com'], ['--orphans'], ['--orphans', '--yes']]) {
            const pool = stubPool([uuid(1)]);
            const { deps, calls, lines } = makeDeps({ admin: null, pool });
            assert.equal(await run(argv, deps), EXIT.usage, argv.join(' '));
            assert.equal(calls.length, 0);
            assert.equal(pool.queries.length, 0);
            assert.match(lines.join('\n'), /SUPABASE_SERVICE_ROLE_KEY/);
        }
    });

    it('the real createAdminClient never falls back to the anon key', async () => {
        for (const key of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']) saved[key] = process.env[key];
        process.env.SUPABASE_URL = 'https://project.example.supabase.co';
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
        process.env.VITE_SUPABASE_ANON_KEY = 'anon-key-for-test';
        assert.equal(await defaultDeps().createAdminClient(), null);
    });

    it('--find-email pages the user list and matches the email in any case', async () => {
        const known = new Set([uuid(1), uuid(2), uuid(3)]);
        const admin = adminWith(known);
        const { deps, calls, lines } = makeDeps({ admin });
        assert.equal(await run(['--find-email', ' SOMEONE@example.COM '], deps), EXIT.ok);
        assert.deepEqual(lines, [`id ${uuid(2)}  created 2026-01-01T00:00:00Z  last sign-in never`]);
        assert.equal(calls.length, 0);
        admin.auth.admin.listUsers = async () => ({ data: { users: [] }, error: { status: 500, code: 'unexpected_failure' } });
        assert.equal(await run(['--find-email', 'someone@example.com'], deps), EXIT.unavailable);
    });
});

describe('scripts/delete-account-data.mjs: --orphans', () => {
    const ids = Array.from({ length: 40 }, (_, i) => uuid(i + 1));

    it('lists only the ids Supabase answers 404 / user_not_found for (8 characters), skips PHASE1, deletes nothing without --yes', async () => {
        const gone = new Set([ids[3], ids[17], ids[30]]);
        const admin = adminWith(new Set(ids.filter((id) => !gone.has(id))), {
            missing: (id) => (id === ids[17]
                ? { data: { user: null }, error: { status: 404, code: undefined, message: 'not found' } }
                : { data: { user: null }, error: { status: 404, code: 'user_not_found' } }),
        });
        const pool = stubPool([...ids, PHASE1_USER_ID]);
        const { deps, calls, lines } = makeDeps({ admin, pool });
        assert.equal(await run(['--orphans'], deps), EXIT.ok);
        assert.equal(calls.length, 0);
        assert.deepEqual(lines.filter((l) => l.startsWith('  orphan ')), [...gone].sort().map((id) => `  orphan ${id.slice(0, 8)}…`));
        assert.ok(lines.every((l) => !ids.some((id) => l.includes(id))), 'no full id is printed');
        assert.ok(!admin.lookups.includes(PHASE1_USER_ID));
        assert.ok(pool.queries.every((q) => q.params[1] === PHASE1_USER_ID));
        assert.ok(lines.includes('Checked 40 Rise Path stubs: 3 unknown to this Supabase project.'));
    });

    it('the stub page statement excludes PHASE1 and pages by id; the script skips PHASE1 even when the database returns it', async () => {
        assert.match(STUB_PAGE_SQL, /^SELECT id FROM auth\.users WHERE id > \$1::uuid AND id <> \$2::uuid ORDER BY id LIMIT 200$/);
        const gone = new Set([ids[5]]);
        for (const yes of [false, true]) {
            const admin = adminWith(new Set(ids.filter((id) => !gone.has(id))));
            const pool = stubPool([PHASE1_USER_ID, ...ids], { ignoreExclusion: true });
            const { deps, calls, lines } = makeDeps({ admin, pool });
            assert.equal(await run(['--orphans', ...(yes ? ['--yes'] : [])], deps), EXIT.ok, `--yes ${yes}`);
            assert.ok(pool.queries.some((q) => q.params[1] === PHASE1_USER_ID), 'the database was given PHASE1 to leave out');
            assert.ok(!admin.lookups.includes(PHASE1_USER_ID), `--yes ${yes}: PHASE1 is never looked up`);
            assert.equal(admin.lookups.length, ids.length, `--yes ${yes}`);
            assert.ok(lines.includes('Checked 40 Rise Path stubs: 1 unknown to this Supabase project.'), `--yes ${yes}: PHASE1 is not counted`);
            if (yes) assert.deepEqual(calls.map((c) => c.userId), [ids[5]], 'only the orphan is deleted');
            else assert.deepEqual(lines.filter((l) => l.startsWith('  orphan ')), [`  orphan ${ids[5].slice(0, 8)}…`]);
        }
    });

    it('--yes deletes each orphan with requestedBy orphan; the worst result decides the exit code', async () => {
        const gone = new Set([ids[1], ids[2]]);
        const admin = adminWith(new Set(ids.filter((id) => !gone.has(id))));
        const { deps, calls } = makeDeps({
            admin,
            pool: stubPool(ids),
            result: (input) => (input.userId === ids[2] ? { status: 'refused', reason: 'subscription_active', memoryDeleted: false } : { status: 'deleted', deletedAt: null }),
        });
        assert.equal(await run(['--orphans', '--yes'], deps), EXIT.refused);
        assert.deepEqual(calls.map((c) => [c.userId, c.requestedBy, c.authTime]), [[ids[1], 'orphan', null], [ids[2], 'orphan', null]]);
    });

    it('a 5xx, an unexpected 4xx or a network error stops the run with exit 3 and lists nothing', async () => {
        for (const missing of [
            () => ({ data: { user: null }, error: { status: 500, code: 'unexpected_failure' } }),
            () => ({ data: { user: null }, error: { status: 403, code: 'not_admin' } }),
            () => ({ data: { user: null }, error: { status: 0, code: undefined, name: 'AuthRetryableFetchError' } }),
            () => {
                throw new TypeError('fetch failed');
            },
            () => ({ data: { user: null }, error: null }),
        ]) {
            const admin = adminWith(new Set(ids.slice(1)), { missing });
            const { deps, calls, lines } = makeDeps({ admin, pool: stubPool(ids) });
            assert.equal(await run(['--orphans', '--yes'], deps), EXIT.unavailable);
            assert.equal(calls.length, 0);
            assert.ok(!lines.some((l) => l.startsWith('  orphan ')));
        }
    });

    it('refuses (exit 2) when more than 10 % of the checked stubs, and more than 5, are unknown (a wrong SUPABASE_URL), and lists them', async () => {
        const unknown = (n) => new Set(ids.slice(n));
        // 6 of 40 unknown (15 %): refused; 4 of 40 (10 %, but not more than 5): listed.
        for (const [known, want] of [[unknown(6), EXIT.refused], [unknown(4), EXIT.ok]]) {
            for (const argv of [['--orphans'], ['--orphans', '--yes']]) {
                const { deps, calls, lines } = makeDeps({ admin: adminWith(known), pool: stubPool(ids) });
                const code = await run(argv, deps);
                assert.equal(code, want === EXIT.ok && argv.includes('--yes') ? EXIT.ok : want, `${known.size} known, ${argv.join(' ')}`);
                if (want === EXIT.refused) {
                    assert.equal(calls.length, 0);
                    assert.ok(lines.includes('Refused: 6 of 40 checked stubs (more than 10 %) are unknown to this Supabase project. Check SUPABASE_URL. If Nexloom or P-School deleted that many logins, confirm the count with them and run again with --expect-orphans 6. Nothing was deleted.'), argv.join(' '));
                    // The ids staff compare with the other operator's report (8 characters).
                    assert.deepEqual(lines.filter((l) => l.startsWith('  orphan ')), ids.slice(0, 6).map((id) => `  orphan ${id.slice(0, 8)}…`), argv.join(' '));
                }
            }
        }
    });

    it('a real batch of shared-login deletions over 10 %: --expect-orphans with the confirmed count deletes exactly those; another count, or no known stub, refuses', async () => {
        const known = new Set(ids.slice(6)); // 6 of 40 unknown (15 %)
        const ok = makeDeps({ admin: adminWith(known), pool: stubPool(ids) });
        assert.equal(await run(['--orphans', '--expect-orphans', '6', '--yes'], ok.deps), EXIT.ok);
        assert.deepEqual(ok.calls.map((c) => [c.userId, c.requestedBy, c.authTime]), ids.slice(0, 6).map((id) => [id, 'orphan', null]));
        const listed = makeDeps({ admin: adminWith(known), pool: stubPool(ids) });
        assert.equal(await run(['--orphans', '--expect-orphans', '6'], listed.deps), EXIT.ok);
        assert.equal(listed.lines.filter((l) => l.startsWith('  orphan ')).length, 6);
        assert.equal(listed.calls.length, 0, 'without --yes nothing is deleted');
        for (const wrong of ['5', '7']) {
            const t = makeDeps({ admin: adminWith(known), pool: stubPool(ids) });
            assert.equal(await run(['--orphans', '--expect-orphans', wrong, '--yes'], t.deps), EXIT.refused, wrong);
            assert.equal(t.calls.length, 0, wrong);
            assert.ok(t.lines.includes(`Refused: --expect-orphans ${wrong}, but 6 of 40 checked stubs are unknown to this Supabase project. Confirm the count again (and SUPABASE_URL). Nothing was deleted.`), wrong);
        }
        // A wrong project: every checked stub unknown. --expect-orphans never bypasses this.
        const none = makeDeps({ admin: adminWith(new Set()), pool: stubPool(ids) });
        assert.equal(await run(['--orphans', '--limit', '10', '--expect-orphans', '10', '--yes'], none.deps), EXIT.refused);
        assert.equal(none.calls.length, 0);
        assert.ok(none.lines.includes('Refused: none of the 10 checked stubs is known to this Supabase project; check SUPABASE_URL, or check more stubs (a higher --limit or an earlier --after). Nothing was deleted.'));
    });

    it('--orphans --yes: a Stripe or Memanto outage on one orphan makes the run exit 3 (try again), over a refusal on another', async () => {
        const known = new Set(ids.slice(2));
        const { deps } = makeDeps({
            admin: adminWith(known),
            pool: stubPool(ids),
            result: (input) => (input.userId === ids[0]
                ? { status: 'refused', reason: 'subscription_active', memoryDeleted: false }
                : { status: 'refused', reason: 'payment_provider_unavailable', memoryDeleted: false }),
        });
        assert.equal(await run(['--orphans', '--yes'], deps), EXIT.unavailable);
    });

    it('a small --limit cannot hide a wrong project: when no checked stub is known it refuses (exit 2), with or without --yes', async () => {
        // A wrong SUPABASE_URL answers 404 user_not_found for every id; 5 or fewer stay under the 10 % rule.
        for (const [limit, yes] of [[5, true], [5, false], [2, true], [1, true]]) {
            const label = `--limit ${limit}${yes ? ' --yes' : ''}`;
            const admin = adminWith(new Set());
            const { deps, calls, lines } = makeDeps({ admin, pool: stubPool(ids) });
            const code = await run(['--orphans', '--limit', String(limit), ...(yes ? ['--yes'] : [])], deps);
            assert.equal(code, EXIT.refused, label);
            assert.equal(calls.length, 0, `${label}: nothing deleted`);
            assert.equal(admin.lookups.length, limit, label);
            assert.ok(lines.includes(`Refused: none of the ${limit} checked stubs is known to this Supabase project; check SUPABASE_URL, or check more stubs (a higher --limit or an earlier --after). Nothing was deleted.`), label);
            assert.ok(!lines.some((l) => l.startsWith('  orphan ')), `${label}: nothing listed as an orphan`);
        }
        // One live login among the checked stubs: the other four are orphans and go with --yes.
        const { deps, calls } = makeDeps({ admin: adminWith(new Set([ids[0]])), pool: stubPool(ids) });
        assert.equal(await run(['--orphans', '--limit', '5', '--yes'], deps), EXIT.ok);
        assert.deepEqual(calls.map((c) => [c.userId, c.requestedBy]), ids.slice(1, 5).map((id) => [id, 'orphan']));
    });

    it('pages the stubs by key set up to --limit', async () => {
        const many = Array.from({ length: 450 }, (_, i) => uuid(i + 1));
        const admin = adminWith(new Set(many));
        const pool = stubPool(many);
        const { deps, lines } = makeDeps({ admin, pool });
        assert.equal(await run(['--orphans', '--limit', '420'], deps), EXIT.ok);
        assert.equal(admin.lookups.length, 420);
        assert.deepEqual(pool.queries.map((q) => q.params[0]), ['00000000-0000-0000-0000-000000000000', many[ORPHAN_PAGE - 1], many[2 * ORPHAN_PAGE - 1]]);
        assert.ok(lines.includes('Checked 420 Rise Path stubs: 0 unknown to this Supabase project.'));
    });

    it('more stubs than --limit: says the rest were not checked and where to go on; --after <8 characters> checks the rest', async () => {
        const many = Array.from({ length: 450 }, (_, i) => uuid(i + 1));
        const gone = new Set([many[430]]);
        const admin = adminWith(new Set(many.filter((id) => !gone.has(id))));
        const first = makeDeps({ admin, pool: stubPool(many) });
        assert.equal(await run(['--orphans', '--limit', '420'], first.deps), EXIT.ok);
        const resume = many[419].slice(0, 8);
        assert.deepEqual(first.lines, [
            'Checked 420 Rise Path stubs: 0 unknown to this Supabase project.',
            `Stopped at --limit 420: more stubs were not checked. Raise --limit, or run again with --after ${resume} to go on from here.`,
        ]);
        assert.ok(first.lines.every((l) => !many.some((id) => l.includes(id))), 'no full id is printed');

        admin.lookups.length = 0;
        const pool = stubPool(many);
        const second = makeDeps({ admin, pool });
        assert.equal(await run(['--orphans', '--after', resume.toUpperCase()], second.deps), EXIT.ok);
        assert.equal(pool.queries[0].params[0], `${resume}-0000-0000-0000-000000000000`);
        assert.deepEqual(admin.lookups, many.slice(419), 'from the last id checked (again) to the end');
        assert.ok(second.lines.includes('Checked 31 Rise Path stubs: 1 unknown to this Supabase project.'));
        assert.ok(second.lines.includes(`  orphan ${many[430].slice(0, 8)}…`));
        assert.ok(!second.lines.some((l) => l.startsWith('Stopped at --limit')));
    });

    it('a limit that ends exactly on a full page looks one page further: the line only when stubs remain', async () => {
        for (const [count, limit, stopped] of [[400, 400, false], [401, 400, true], [200, 200, false], [199, 200, false], [201, 200, true]]) {
            const many = Array.from({ length: count }, (_, i) => uuid(i + 1));
            const admin = adminWith(new Set(many));
            const { deps, lines } = makeDeps({ admin, pool: stubPool(many) });
            assert.equal(await run(['--orphans', '--limit', String(limit)], deps), EXIT.ok);
            assert.equal(admin.lookups.length, Math.min(count, limit), `${count} stubs, --limit ${limit}`);
            assert.equal(lines.some((l) => l.startsWith(`Stopped at --limit ${limit}: more stubs were not checked.`)), stopped, `${count} stubs, --limit ${limit}`);
        }
    });

    it('parseArgs: --after takes an account id or its first 1 to 8 characters, and only with --orphans', () => {
        assert.equal(parseArgs(['--orphans', '--after', A.toUpperCase()]).after, A);
        assert.equal(parseArgs(['--orphans', '--after', 'ABCD01a4']).after, 'abcd01a4-0000-0000-0000-000000000000');
        assert.equal(parseArgs(['--orphans', '--after', '3']).after, '30000000-0000-0000-0000-000000000000');
        for (const bad of ['abcd01a4…', 'xyz', 'abcd01a4x', '123456789', "'; drop table x"]) {
            assert.match(parseArgs(['--orphans', '--after', bad]).error, /--after must be an account id/, bad);
        }
        assert.match(parseArgs(['--orphans', '--after']).error, /needs a value/);
        assert.match(parseArgs(['--user', A, '--yes', '--after', 'abcd01a4']).error, /--after only goes with --orphans/);
    });

    it('parseArgs: --expect-orphans takes a whole number from 1 to 100000, only with --orphans', () => {
        assert.equal(parseArgs(['--orphans', '--expect-orphans', '40']).expectOrphans, 40);
        for (const bad of ['0', 'x', '-3', '1.5', '100001']) {
            assert.match(parseArgs(['--orphans', '--expect-orphans', bad]).error, /--expect-orphans must be a whole number from 1 to 100000/, bad);
        }
        assert.match(parseArgs(['--orphans', '--expect-orphans']).error, /needs a value/);
        assert.match(parseArgs(['--user', A, '--yes', '--expect-orphans', '3']).error, /--expect-orphans only goes with --orphans/);
    });
});
