#!/usr/bin/env node
// @ts-check
/**
 * Proves migration 018 (account deletion, proof of consent) and the deleted-account checks on a
 * real, THROWAWAY PostgreSQL (16, as the VM's pgvector/pgvector:0.8.7-pg16). CI has no Postgres,
 * so npm test pins the SQL text (server/tests/migration018.test.js, accountState.test.js); this
 * script runs it. It is the stage gate of Phase 4 and the 確かめ方 of server/migrations/README.md.
 *
 *   createdb -h 127.0.0.1 -p 55441 -U postgres verify
 *   node scripts/db/verify-account-deletion.mjs --url postgres://postgres@127.0.0.1:55441/verify
 *
 * It refuses (exit 2) unless the database has no table in public or auth, the role
 * risepath_mcp_remote does not exist in the cluster, and the user is a superuser: it can never run
 * against the VM's database or a Supabase project. It applies every server/migrations/*.sql twice,
 * each in its own transaction (as scripts/db-migrate.mjs does once), seeds test rows, runs the
 * checks with two or three connections and timed waits, prints one line per check and exits 1 on
 * any mismatch. It creates the role risepath_mcp_remote for R5 and drops it again at the end. The
 * database keeps the test rows: drop it (or the whole cluster) afterwards.
 *
 * Checks (doc: Phase 4 design, Appendix V):
 *   FK  after 018 no FK to auth.users is NO ACTION; the four re-added FKs are SET NULL/CASCADE, once
 *   R1  deletion first: a stub insert during it waits for the shared lock and inserts nothing
 *   R2  stub insert first (in a transaction): the deletion waits for it, then removes the stub
 *   R3  control: the trigger without its lock brings the stub back (the lock is needed)
 *   R4  re-open vs deletion: no deadlock; re-open in one transaction (reopened_at = reset_at);
 *       a session from before a second deletion cannot re-open (the UPDATE re-checks it)
 *   R5  as risepath_mcp_remote: the trigger needs the 018 grant; the verifier's query
 *   R6  a seeded learner deleted in one transaction: what goes, what stays, what is marked
 *   R7  version archive rows never change; a version id must match its document
 *   R8  the lock key is canonical: an upper-case id locks what the trigger locks
 *   Later stages add R9 (the deletion service against a concurrent acceptance), R10 (retention)
 *   and R11 (the db log without DETAIL).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { accountGeneration, accountLockKey, readAccountState, reopenAccount } from '../../tools/core/accountDeletions.js';
import { isGrantRevoked } from '../../mcp-server/oauthVerifier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(ROOT, 'server', 'migrations');
const ROLE = 'risepath_mcp_remote';
const HOLD_MS = 2000;
const LEAD_MS = 600;
/** A waiter counts as blocked when it waited at least this long (HOLD_MS - LEAD_MS minus slack). */
const BLOCKED_MS = HOLD_MS - LEAD_MS - 400;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;
/**
 * A fresh, distinct UUID per test row (tag and counter in hex). It always has letters, so its
 * upper-case form differs from it and the canonical-id checks are not vacuous.
 * @param {string} tag
 */
const uid = (tag) => {
    counter += 1;
    const n = counter.toString(16).padStart(4, '0');
    const hex = (Buffer.from(tag).toString('hex') + n).padEnd(12, '0').slice(-12);
    return `abcd${n}-0000-4000-8000-${hex}`;
};

/** @type {{ id: string, ok: boolean }[]} */
const results = [];
/** @param {string} id @param {boolean} ok @param {string} label */
function check(id, ok, label) {
    results.push({ id, ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(4)} ${label}`);
}

/** @param {string[]} argv */
function parseArgs(argv) {
    const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : '';
    return { url, help: argv.includes('--help') || argv.includes('-h') };
}

/** @param {pg.Pool} pool @param {string} sql @param {unknown[]} [params] */
const count = async (pool, sql, params = []) => Number((await pool.query(sql, params)).rows[0]?.n ?? NaN);

async function migrationFiles() {
    return (await fs.readdir(MIGRATIONS)).filter((name) => /^\d+_.+\.sql$/i.test(name)).sort((a, b) => a.localeCompare(b));
}

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

/** The deletion's own statements (Phase 4 design §5.6) up to DELETE FROM auth.users, without COMMIT. */
const DELETION = {
    lock: `SELECT pg_advisory_xact_lock(${accountLockKey(1)})`,
    tombstone: `INSERT INTO account_deletions (user_id, deleted_at, requested_by) VALUES ($1::uuid, clock_timestamp(), $2)
                ON CONFLICT (user_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at, requested_by = EXCLUDED.requested_by, reopened_at = NULL
                RETURNING deleted_at`,
    stub: 'DELETE FROM auth.users WHERE id = $1::uuid',
};
const STUB_INSERT = 'INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT (id) DO NOTHING';
const stubCount = (/** @type {pg.Pool} */ pool, /** @type {string} */ id) => count(pool, 'SELECT count(*) AS n FROM auth.users WHERE id = $1::uuid', [id]);

/**
 * Deletion first, held HOLD_MS; a stub insert LEAD_MS later. Returns how long the insert waited and
 * the stub count after both finished.
 * @param {pg.Pool} pool @param {string} id @param {string} [lockId] the id the deletion locks with
 */
async function deletionThenStub(pool, id, lockId = id) {
    await pool.query(STUB_INSERT, [id]);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
        await c1.query('BEGIN');
        await c1.query(DELETION.lock, [lockId]);
        await c1.query(DELETION.tombstone, [id, 'self']);
        await c1.query(DELETION.stub, [id]);
        const hold = c1.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]);
        await sleep(LEAD_MS);
        const t0 = Date.now();
        const insert = c2.query(STUB_INSERT, [id]).then((r) => ({ rowCount: r.rowCount, waited: Date.now() - t0 }));
        await hold;
        await c1.query('COMMIT');
        const { rowCount, waited } = await insert;
        return { rowCount, waited, stubs: await stubCount(pool, id) };
    } finally {
        c1.release();
        c2.release();
    }
}

/** @param {pg.Pool} pool */
async function checkForeignKeys(pool) {
    const noAction = await count(pool, `SELECT count(*) AS n FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'auth.users'::regclass AND confdeltype = 'a'`);
    check('FK', noAction === 0, `no NO ACTION foreign key to auth.users is left (found ${noAction})`);
    const { rows } = await pool.query(`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confdeltype AS action, count(*) OVER (PARTITION BY c.conrelid, a.attname) AS n
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
          AND (c.conrelid::regclass::text, a.attname) IN (('curriculum_versions', 'created_by'), ('approvals', 'decided_by'), ('jobs', 'user_id'), ('mcp_sessions', 'user_id'))
        ORDER BY 1`);
    const got = rows.map((r) => `${r.tbl}.${r.col}:${r.action}:${r.n}`).join(' ');
    check('FK', got === 'approvals.decided_by:n:1 curriculum_versions.created_by:n:1 jobs.user_id:c:1 mcp_sessions.user_id:c:1',
        `the four FKs are SET NULL (n) / CASCADE (c), once each after two runs: ${got}`);
}

/** @param {pg.Pool} pool */
async function r1r2r3(pool) {
    const r1 = await deletionThenStub(pool, uid('r1'));
    check('R1', r1.waited >= BLOCKED_MS && r1.rowCount === 0 && r1.stubs === 0,
        `deletion first: the stub insert waited ${r1.waited} ms and inserted nothing (stub ${r1.stubs})`);

    // R2: the stub insert's transaction holds the shared lock; the deletion waits for its COMMIT.
    const id = uid('r2');
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
        await c2.query('BEGIN');
        await c2.query(STUB_INSERT, [id]);
        const hold = c2.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]);
        await sleep(LEAD_MS);
        await c1.query('BEGIN');
        await c1.query("SET LOCAL lock_timeout = '10s'");
        const t0 = Date.now();
        const locked = c1.query(DELETION.lock, [id]).then(() => Date.now() - t0);
        await hold;
        await c2.query('COMMIT');
        const waited = await locked;
        await c1.query(DELETION.tombstone, [id, 'self']);
        const deleted = (await c1.query(DELETION.stub, [id])).rowCount;
        await c1.query('COMMIT');
        const later = (await pool.query(STUB_INSERT, [id])).rowCount;
        const stubs = await stubCount(pool, id);
        check('R2', waited >= BLOCKED_MS && deleted === 1 && later === 0 && stubs === 0,
            `stub insert first: the deletion waited ${waited} ms, removed the stub (${deleted}); a later insert inserted ${later} (stub ${stubs})`);
    } finally {
        c1.release();
        c2.release();
    }

    // R3: the same as R1 with the lock taken out of the trigger brings the stub back.
    const migration = await fs.readFile(path.join(MIGRATIONS, '018_account_deletion_and_legal.sql'), 'utf8');
    const fn = /CREATE OR REPLACE FUNCTION public\.rp_skip_deleted_account_stub\(\)[\s\S]*?END \$\$;/.exec(migration)?.[0];
    if (!fn) throw new Error('018: trigger function not found');
    const lockLine = /^\s*PERFORM pg_advisory_xact_lock_shared\(.*\);\n/m;
    if (!lockLine.test(fn)) throw new Error('018: the trigger has no shared lock line');
    await pool.query(fn.replace(lockLine, ''));
    try {
        const r3 = await deletionThenStub(pool, uid('r3'));
        check('R3', r3.stubs === 1, `control, trigger without the lock: the stub came back (stub ${r3.stubs}), so the lock is needed`);
    } finally {
        await pool.query(fn);
    }
}

/** @param {pg.Pool} pool */
async function r4(pool) {
    const nowS = () => Date.now() / 1000;
    /** A deleted account whose deletion committed `ago` seconds ago (no stub, no epoch). */
    const deletedAccount = async (tag, ago) => {
        const id = uid(tag);
        await pool.query(`INSERT INTO account_deletions (user_id, deleted_at, requested_by) VALUES ($1::uuid, now() - make_interval(secs => $2), 'self')`, [id, ago]);
        return id;
    };

    // R4a: a re-open holding the shared lock HOLD_MS, a second deletion LEAD_MS later.
    {
        const id = await deletedAccount('r4a', 600);
        /** @type {any} */
        const slowPool = {
            connect: async () => {
                const client = await pool.connect();
                return {
                    query: async (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
                        if (sql === 'COMMIT') await client.query('SELECT pg_sleep($1)', [HOLD_MS / 1000]);
                        return client.query(sql, params);
                    },
                    release: () => client.release(),
                };
            },
        };
        const reopen = reopenAccount(slowPool, id, nowS());
        await sleep(LEAD_MS);
        const c1 = await pool.connect();
        let error = null;
        let waited = 0;
        try {
            const t0 = Date.now();
            await c1.query('BEGIN');
            await c1.query("SET LOCAL lock_timeout = '10s'");
            await c1.query(DELETION.lock, [id]);
            waited = Date.now() - t0;
            await c1.query(DELETION.tombstone, [id, 'self']);
            await c1.query(DELETION.stub, [id]);
            await c1.query('COMMIT');
        } catch (e) {
            error = /** @type {any} */ (e);
            await c1.query('ROLLBACK').catch(() => {});
        } finally {
            c1.release();
        }
        const reopenedAt = await reopen;
        const stubs = await stubCount(pool, id);
        const resets = await count(pool, 'SELECT count(*) AS n FROM lesson_progress_resets WHERE user_id = $1::uuid', [id]);
        const row = (await pool.query('SELECT reopened_at FROM account_deletions WHERE user_id = $1::uuid', [id])).rows[0];
        check('R4', !error && reopenedAt instanceof Date && waited >= BLOCKED_MS && stubs === 0 && resets === 0 && row.reopened_at === null,
            `re-open vs deletion: no deadlock (${error ? error.code : 'none'}), the deletion waited ${waited} ms; after: stub ${stubs}, epochs ${resets}, reopened_at ${row.reopened_at}`);
    }

    // R4b: readAccountState re-opens in one transaction: reopened_at = reset_at, the stub is back.
    {
        const id = await deletedAccount('r4b', 600);
        const first = await readAccountState(pool, id.toUpperCase(), nowS(), { mayReopen: true });
        const second = await readAccountState(pool, id, nowS(), { mayReopen: true });
        const { rows } = await pool.query(`SELECT d.reopened_at = r.reset_at AS restarted, d.reopened_at, r.epoch
            FROM account_deletions d JOIN lesson_progress_resets r USING (user_id) WHERE d.user_id = $1::uuid`, [id]);
        const stubs = await stubCount(pool, id);
        const generation = first.state === 'ok' ? first.generation : undefined;
        check('R4', rows.length === 1 && rows[0].restarted === true && stubs === 1 && generation === accountGeneration(rows[0].reopened_at)
            && JSON.stringify(second) === JSON.stringify(first),
            `re-open in one transaction: restarted ${rows[0]?.restarted}, stub ${stubs}, one epoch, the same generation twice (${generation})`);
        const old = await readAccountState(pool, id, nowS() - 3600, { mayReopen: true });
        check('R4', old.state === 'deleted', `a session from before the deletion stays refused after the re-open (${old.state})`);
    }

    // R4c: a session that signed in after the first deletion but before a second one cannot re-open.
    {
        const id = await deletedAccount('r4c', 5);
        const authTime = nowS() - 120; // before this (second) deletion
        const reopenedAt = await reopenAccount(pool, id, authTime);
        const row = (await pool.query('SELECT reopened_at FROM account_deletions WHERE user_id = $1::uuid', [id])).rows[0];
        const stubs = await stubCount(pool, id);
        // Control: the UPDATE without the session re-check would have re-opened it.
        const client = await pool.connect();
        let wouldReopen = 0;
        try {
            await client.query('BEGIN');
            wouldReopen = (await client.query(`UPDATE account_deletions SET reopened_at = now()
                WHERE user_id = $1::uuid AND reopened_at IS NULL RETURNING reopened_at`, [id])).rowCount ?? 0;
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
        check('R4', reopenedAt === null && row.reopened_at === null && stubs === 0 && wouldReopen === 1,
            `a session from before a second deletion: not re-opened (stub ${stubs}); without the re-check it would have been (${wouldReopen})`);
    }
}

/** @param {pg.Pool} pool */
async function r5(pool) {
    await pool.query(`CREATE ROLE ${ROLE} NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public, auth TO ${ROLE}`);
    await pool.query(`GRANT SELECT, INSERT ON auth.users TO ${ROLE}`);
    await pool.query(`GRANT SELECT (user_id, client_id, revoked_at, first_seen_at, last_used_at) ON mcp_oauth_grants TO ${ROLE}`);
    const deleted = uid('r5d');
    const fresh = uid('r5n');
    const reopened = uid('r5r');
    const client = await pool.connect();
    /** @param {string} sql @param {unknown[]} [params] */
    const asRole = async (sql, params = []) => {
        await client.query(`SET ROLE ${ROLE}`);
        try {
            return await client.query(sql, params);
        } finally {
            await client.query('RESET ROLE');
        }
    };
    /** @param {Promise<unknown>} promise */
    const errorCode = (promise) => promise.then(() => 'none', (e) => `${e.code} ${e.message}`);
    try {
        await pool.query(`INSERT INTO account_deletions (user_id, deleted_at, requested_by) VALUES ($1::uuid, now() - interval '1 hour', 'self')`, [deleted]);
        const before = await errorCode(asRole(STUB_INSERT, [fresh]));
        check('R5', before.startsWith('42501') && before.includes('account_deletions'),
            `without the 018 grant the remote role cannot insert a stub: ${before}`);

        await applyMigration(pool, '018_account_deletion_and_legal.sql');
        const skipped = (await asRole(STUB_INSERT, [deleted])).rowCount;
        const inserted = (await asRole(STUB_INSERT, [fresh])).rowCount;
        check('R5', skipped === 0 && inserted === 1, `after re-running 018 (conditional grant): deleted id → ${skipped} stub, new id → ${inserted}`);

        await pool.query(`INSERT INTO account_deletions (user_id, deleted_at, requested_by, reopened_at) VALUES ($1::uuid, now() - interval '1 hour', 'self', now() - interval '30 minutes')`, [reopened]);
        const nowS = Math.floor(Date.now() / 1000);
        const roleDb = { query: (/** @type {string} */ sql, /** @type {unknown[]} */ params) => asRole(sql, params) };
        const client1 = uid('r5c');
        /** @param {string} userId @param {number | null} authTime */
        const refused = (userId, authTime) => isGrantRevoked(roleDb, { userId, clientId: client1, iat: nowS - 5, authTime });
        const cases = [
            ['not re-opened, a fresh agent', await refused(deleted, nowS), true],
            ['re-opened, a session from before the deletion', await refused(reopened, nowS - 7200), true],
            ['re-opened, a session after it', await refused(reopened, nowS), false],
            ['re-opened, no auth time', await refused(reopened, null), true],
            ['never deleted', await refused(fresh, nowS), false],
        ];
        for (const [label, got, want] of cases) check('R5', got === want, `verifier query as the remote role: ${label} → ${got ? 'refused' : 'passes'}`);
        const star = await errorCode(asRole('SELECT * FROM account_deletions'));
        check('R5', star.startsWith('42501'), `the remote role cannot read requested_by (SELECT *: ${star.split(' ')[0]})`);
    } finally {
        client.release();
    }
}

/** @param {pg.Pool} pool */
async function r6(pool) {
    const A = uid('r6a');
    const B = uid('r6b');
    const [CA, CB, VA, VB, VBA, SA, G1, G2] = ['ca', 'cb', 'va', 'vb', 'vx', 'sa', 'g1', 'g2'].map(uid);
    const terms = 'terms-draft-2026-10-01';
    const privacy = 'privacy-draft-2026-10-01';
    const today = "(now() AT TIME ZONE 'Asia/Tokyo')::date";
    const seed = [
        ['INSERT INTO auth.users (id) VALUES ($1), ($2)', [A, B]],
        ["INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'A'), ($2, 'B')", [A, B]],
        ["INSERT INTO curricula (id, user_id, title) VALUES ($1, $2, 'a'), ($3, $4, 'b')", [CA, A, CB, B]],
        // A's own version, B's version, and a version A wrote in B's curriculum (kept, author NULL).
        ['INSERT INTO curriculum_versions (id, curriculum_id, version, created_by) VALUES ($1, $2, 1, $3), ($4, $5, 1, $6), ($7, $5, 2, $3)', [VA, CA, A, VB, CB, B, VBA]],
        ["INSERT INTO approvals (curriculum_version_id, stage, decision, decided_by) VALUES ($1, 'requirements', 'approved', $2)", [VB, A]],
        ["INSERT INTO learning_journal (user_id, curriculum_id, module_id, lesson_id, learned) VALUES ($1, $2, 'm', 'l', 'x')", [A, CA]],
        ["INSERT INTO jobs (user_id, type, status) VALUES ($1, 'ingest', 'running'), ($2, 'ingest', 'done')", [A, B]],
        ['INSERT INTO mcp_sessions (id, user_id) VALUES ($1, $2)', [SA, A]],
        ["INSERT INTO mcp_tool_calls (session_id, tool_name) VALUES ($1, 'journal-log')", [SA]],
        ["INSERT INTO materials (user_id, type, storage_path) VALUES ($1, 'txt', 'public/uploads/1700000000000-a.txt')", [A]],
        ['INSERT INTO lesson_progress_resets (user_id) VALUES ($1)', [A]],
        ["INSERT INTO ai_safety_events (user_id, surface, kind) VALUES ($1, 'tutor', 'input_blocked')", [A]],
        ["INSERT INTO billing_customers (stripe_customer_id, user_id, livemode) VALUES ($1, $2, false)", [`cus_${A}`, A]],
        [`INSERT INTO ai_daily_usage (usage_day, kind, subject, count) VALUES (${today}, 'llm', $1, 3), (${today} - 3, 'llm', $1, 2), (${today}, 'llm', $2, 1)`, [A, `ip:198.51.100.${counter % 250}`]],
        ["INSERT INTO account_consents (user_id, kind, policy_version, method, relationship) VALUES ($1, 'guardian_ai', 'guardian-ai-2026-10', 'guardian_on_device', 'parent')", [A]],
        ["INSERT INTO mcp_oauth_grants (user_id, client_id, client_name) VALUES ($1, $2, 'used app')", [A, G1]],
        ["INSERT INTO mcp_oauth_grants (user_id, client_id, client_name, first_seen_at, last_used_at) VALUES ($1, $2, 'never used', NULL, NULL)", [A, G2]],
        ["INSERT INTO legal_document_versions (version, document, sha256) VALUES ($1, 'terms', repeat('a', 64)), ($2, 'privacy', repeat('b', 64)) ON CONFLICT DO NOTHING", [terms, privacy]],
        ['INSERT INTO legal_acceptances (user_id, terms_version, privacy_version) VALUES ($1, $2, $3)', [A, terms, privacy]],
    ];
    for (const [sql, params] of seed) await pool.query(/** @type {string} */ (sql), /** @type {unknown[]} */ (params));
    const ACCEPT = `INSERT INTO legal_acceptances (user_id, terms_version, privacy_version) VALUES ($1::uuid, $2, $3)
        ON CONFLICT (user_id, terms_version, privacy_version) WHERE account_deleted_at IS NULL DO NOTHING`;
    const duplicate = (await pool.query(ACCEPT, [A, terms, privacy])).rowCount;
    check('R6', duplicate === 0, `a repeated acceptance of the same versions inserts nothing (${duplicate})`);

    // The deletion (design §5.6), with the id in upper case as staff might type it.
    const id = A.toUpperCase();
    const client = await pool.connect();
    let paths = [];
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '60s'");
        await client.query(DELETION.lock, [id]);
        await client.query('SELECT deleted_at, reopened_at FROM account_deletions WHERE user_id = $1::uuid FOR UPDATE', [id]);
        paths = (await client.query('SELECT storage_path FROM materials WHERE user_id = $1::uuid AND storage_path IS NOT NULL', [id])).rows;
        const deletedAt = (await client.query(DELETION.tombstone, [id, 'staff'])).rows[0].deleted_at;
        await client.query('UPDATE legal_acceptances SET account_deleted_at = $2 WHERE user_id = $1::uuid AND account_deleted_at IS NULL', [id, deletedAt]);
        await client.query(`INSERT INTO account_consent_proofs (consent_id, user_id, kind, policy_version, method, given_at, revoked_at, account_deleted_at)
            SELECT id, user_id, kind, policy_version, method, given_at, revoked_at, $2 FROM account_consents WHERE user_id = $1::uuid
            ON CONFLICT (consent_id) DO NOTHING`, [id, deletedAt]);
        await client.query(`INSERT INTO ai_app_provision_records (user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at, account_deleted_at)
            SELECT user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at, $2 FROM mcp_oauth_grants
             WHERE user_id = $1::uuid AND (first_seen_at IS NOT NULL OR last_used_at IS NOT NULL)
            ON CONFLICT DO NOTHING`, [id, deletedAt]);
        await client.query(`DELETE FROM ai_daily_usage WHERE subject = $1::uuid::text AND usage_day < ${today}`, [id]);
        await client.query(DELETION.stub, [id]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        check('R6', false, `the deletion transaction failed: ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`);
        return;
    } finally {
        client.release();
    }
    const n = (/** @type {string} */ sql, /** @type {unknown[]} */ params = [A]) => count(pool, sql, params);
    const got = {
        stub: await n('SELECT count(*) AS n FROM auth.users WHERE id = $1'),
        curriculaA: await n('SELECT count(*) AS n FROM curricula WHERE user_id = $1'),
        versionInB: (await pool.query('SELECT created_by FROM curriculum_versions WHERE id = $1', [VBA])).rows.map((r) => r.created_by ?? 'NULL').join(),
        approvalAuthor: (await pool.query('SELECT decided_by FROM approvals WHERE curriculum_version_id = $1', [VB])).rows.map((r) => r.decided_by ?? 'NULL').join(),
        jobsA: await n('SELECT count(*) AS n FROM jobs WHERE user_id = $1'),
        jobsB: await n('SELECT count(*) AS n FROM jobs WHERE user_id = $1', [B]),
        mcp: await n('SELECT count(*) AS n FROM mcp_sessions s LEFT JOIN mcp_tool_calls t ON t.session_id = s.id WHERE s.id = $1', [SA]),
        materials: await n('SELECT count(*) AS n FROM materials WHERE user_id = $1'),
        journal: await n('SELECT count(*) AS n FROM learning_journal WHERE user_id = $1'),
        resets: await n('SELECT count(*) AS n FROM lesson_progress_resets WHERE user_id = $1'),
        safetyKept: await n("SELECT count(*) AS n FROM ai_safety_events WHERE user_id IS NULL AND surface = 'tutor' AND created_at > now() - interval '1 hour'", []),
        billingKept: await n('SELECT count(*) AS n FROM billing_customers WHERE stripe_customer_id = $1 AND user_id IS NULL', [`cus_${A}`]),
        usageA: (await pool.query(`SELECT usage_day = ${today} AS today FROM ai_daily_usage WHERE subject = $1`, [A])).rows.map((r) => r.today).join(),
        ipKept: await n('SELECT count(*) AS n FROM ai_daily_usage WHERE subject LIKE $1', [`ip:198.51.100.%`]),
        acceptanceMarked: await n('SELECT count(*) AS n FROM legal_acceptances WHERE user_id = $1 AND account_deleted_at IS NOT NULL'),
        acceptanceLive: await n('SELECT count(*) AS n FROM legal_acceptances WHERE user_id = $1 AND account_deleted_at IS NULL'),
        consents: await n('SELECT count(*) AS n FROM account_consents WHERE user_id = $1'),
        consentProofs: await n("SELECT count(*) AS n FROM account_consent_proofs WHERE user_id = $1 AND policy_version = 'guardian-ai-2026-10'"),
        provision: (await pool.query('SELECT client_id FROM ai_app_provision_records WHERE user_id = $1', [A])).rows.map((r) => (r.client_id === G1 ? 'used' : r.client_id)).join(),
        tombstone: (await pool.query('SELECT requested_by, reopened_at FROM account_deletions WHERE user_id = $1', [A])).rows.map((r) => `${r.requested_by}/${r.reopened_at}`).join(),
    };
    const want = {
        stub: 0, curriculaA: 0, versionInB: 'NULL', approvalAuthor: 'NULL', jobsA: 0, jobsB: 1, mcp: 0, materials: 0, journal: 0, resets: 0,
        safetyKept: 1, billingKept: 1, usageA: 'true', ipKept: 1, acceptanceMarked: 1, acceptanceLive: 0, consents: 0, consentProofs: 1,
        provision: 'used', tombstone: 'staff/null',
    };
    const wrong = Object.keys(want).filter((k) => got[k] !== want[k]);
    check('R6', wrong.length === 0 && paths.length === 1,
        wrong.length ? `after the deletion, unexpected: ${wrong.map((k) => `${k}=${got[k]} (want ${want[k]})`).join(', ')}`
            : 'a seeded learner deleted in one transaction (upper-case id): own rows gone, B\'s version kept with created_by NULL, jobs A 0 / B 1, today\'s usage row kept, proofs copied (1 consent, the used grant only), acceptance marked, stub 0');
    const again = (await pool.query(ACCEPT, [A, terms, privacy])).rowCount;
    check('R6', again === 1, `after the deletion the same versions can be accepted again (a new account): inserted ${again}`);
}

/** @param {pg.Pool} pool */
async function r7(pool) {
    const version = 'terms-2026-10-01';
    await pool.query("INSERT INTO legal_document_versions (version, document, sha256) VALUES ($1, 'terms', repeat('c', 64)) ON CONFLICT DO NOTHING", [version]);
    /** @param {string} sql @param {unknown[]} params */
    const codeOf = (sql, params) => pool.query(sql, params).then(() => 'none', (e) => `${e.code} ${e.message}`);
    const update = await codeOf("UPDATE legal_document_versions SET sha256 = repeat('d', 64) WHERE version = $1", [version]);
    const del = await codeOf('DELETE FROM legal_document_versions WHERE version = $1', [version]);
    check('R7', update.includes('legal_document_versions rows never change') && del.startsWith('23001'), `archive rows never change: UPDATE → ${update}; DELETE → ${del.split(' ')[0]}`);
    const mismatch = await codeOf("INSERT INTO legal_document_versions (version, document, sha256) VALUES ('privacy-2026-10-01', 'terms', repeat('e', 64))", []);
    const badId = await codeOf("INSERT INTO legal_document_versions (version, document, sha256) VALUES ('terms-2026-1-1', 'terms', repeat('e', 64))", []);
    check('R7', mismatch.startsWith('23514') && badId.startsWith('23514'), `a version id must match its document and the pattern (CHECK: ${mismatch.split(' ')[0]}, ${badId.split(' ')[0]})`);
}

/** @param {pg.Pool} pool */
async function r8(pool) {
    const id = uid('r8');
    const upper = id.toUpperCase();
    if (upper === id) throw new Error('R8 needs an id with letters');
    const { rows: [keys] } = await pool.query(`SELECT ${accountLockKey(1)} = hashtextextended('rp:account:' || $2, 0) AS canonical,
        hashtextextended('rp:account:' || $3, 0) = hashtextextended('rp:account:' || $2, 0) AS raw`, [upper, id, upper]);
    check('R8', keys.canonical === true && keys.raw === false,
        `the app key of an upper-case id equals the lower-case key (${keys.canonical}); the raw upper-case text does not (${keys.raw})`);
    const blocked = await deletionThenStub(pool, id, upper);
    check('R8', blocked.waited >= BLOCKED_MS && blocked.stubs === 0,
        `a deletion locking with the upper-case id blocks the trigger's lower-case lock: the stub insert waited ${blocked.waited} ms (stub ${blocked.stubs})`);
}

export async function main(argv = process.argv.slice(2)) {
    const { url, help } = parseArgs(argv);
    if (help || !url) {
        console.log('Usage: node scripts/db/verify-account-deletion.mjs --url postgres://<user>@<host>:<port>/<empty throwaway database>');
        return help ? 0 : 2;
    }
    const pool = new pg.Pool({ connectionString: url, max: 6 });
    let createdRole = false;
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
        console.log(`# verify-account-deletion: database ${target.db}, PostgreSQL ${target.version}`);

        const files = await migrationFiles();
        for (const run of [1, 2]) {
            for (const file of files) await applyMigration(pool, file);
            check('M', true, `run ${run}: applied ${files.length} migrations (${files[0]} … ${files.at(-1)}), each in its own transaction`);
        }
        await checkForeignKeys(pool);
        await r1r2r3(pool);
        await r4(pool);
        createdRole = true;
        await r5(pool);
        await r6(pool);
        await r7(pool);
        await r8(pool);
    } catch (error) {
        check('ERR', false, /** @type {Error} */ (error).stack ?? String(error));
    } finally {
        if (createdRole) {
            await pool.query(`DROP OWNED BY ${ROLE}`).catch(() => {});
            await pool.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
        }
        await pool.end();
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`# ${results.length - failed.length} passed, ${failed.length} failed`);
    return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
}
