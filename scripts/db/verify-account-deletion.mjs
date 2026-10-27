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
 * any mismatch, or 3 when a check could not run here (R11 without a readable server log) unless
 * --allow-skip is given: a skipped check is not a pass, so a gate never goes green without it. It creates the role risepath_mcp_remote for R5 and drops it again at the end. The
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
 *       (with migration 019's lesson resets, XP awards and learning days, and migration 020's review
 *       cards and review log: all go)
 *   R7  version archive rows never change; a version id must match its document
 *   R8  the lock key is canonical: an upper-case id locks what the trigger locks
 *   R9  the deletion service (server/services/accountDeletion.js) on a seeded learner: a terms
 *       acceptance started during it waits for the shared lock and inserts nothing (control:
 *       without the lock it leaves a live row); one started before it is marked; every proof row
 *       carries the tombstone's deleted_at to the microsecond; a second call answers already; the
 *       lesson-progress `restarted` statement after a re-open; a guardian consent whose INSERT is in
 *       flight when the deletion starts is copied to the proofs (the deletion waits for it), and a
 *       consent or AI-app grant written while the deletion is between its copies and the stub
 *       waits and then fails its foreign key (control: without the row locks both are cascaded
 *       with no proof); an app name from the page fills a grant row that has none
 *   R10 the retention run (server/services/retention.js) on seeded rows: what each period keeps and
 *       deletes (usage counts by Japan-time day, jobs in every status, MCP records, the proofs of
 *       deleted accounts, tombstones), batches of 5000, orphan upload files, and the advisory lock
 *       (a run while another session holds it deletes nothing); a tombstone past its period that a
 *       second deletion rewrites while the run's DELETE waits on its row lock is kept (control:
 *       without the outer age test the fresh tombstone is deleted)
 *   R11 a foreign key refusal in the server log: with the default log_error_verbosity the DETAIL
 *       line carries the full id; with terse (docker-compose.yml's db command) it does not, and the
 *       STATEMENT line holds $1. The log is read from --log-file <path> when given, else from
 *       pg_current_logfile() (logging_collector on); without either, R11 is skipped (exit 3).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import os from 'node:os';
import { accountGeneration, accountLockKey, readAccountState, reopenAccount } from '../../tools/core/accountDeletions.js';
import { RESTARTED_SQL } from '../../tools/core/lessonProgress.js';
import { isGrantRevoked } from '../../mcp-server/oauthVerifier.js';
import { deleteAccountData, SQL as DELETION_SQL } from '../../server/services/accountDeletion.js';
import { BATCH_LIMIT, RETENTION_LOCK_SQL, readRetentionConfig, runRetention } from '../../server/services/retention.js';

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
/** Checks that could not run here (not a pass, not a failure). @type {string[]} */
const skipped = [];
/** @param {string} id @param {string} label */
function skip(id, label) {
    skipped.push(id);
    console.log(`skip ${id.padEnd(4)} ${label}`);
}

/** @param {string[]} argv */
export function parseArgs(argv) {
    const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : '';
    const logFile = argv.includes('--log-file') ? argv[argv.indexOf('--log-file') + 1] ?? '' : '';
    return { url, logFile, allowSkip: argv.includes('--allow-skip'), help: argv.includes('--help') || argv.includes('-h') };
}

/**
 * 1 when a check failed; 3 when one was skipped (not a pass) and --allow-skip was not given; else 0.
 * @param {{ failed: number, skipped: number, allowSkip: boolean }} counts
 */
export function exitCode({ failed, skipped, allowSkip }) {
    if (failed > 0) return 1;
    if (skipped > 0 && !allowSkip) return 3;
    return 0;
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
        // The lesson-progress GET's own statement (tools/core/lessonProgress.js), then after a normal reset.
        const flag = async () => (await pool.query(RESTARTED_SQL, [id.toUpperCase()])).rows[0]?.restarted;
        const before = await flag();
        await pool.query('UPDATE lesson_progress_resets SET epoch = gen_random_uuid(), reset_at = now() + interval \'1 second\' WHERE user_id = $1::uuid', [id]);
        const afterReset = await flag();
        check('R4', before === true && afterReset === false, `RESTARTED_SQL: true after the re-open (${before}), false after a normal reset (${afterReset})`);
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
        // Phase 5 (migration 019): a lesson record, a lesson started over, an XP award, a learning day.
        ["INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, state, progress_updated_at) VALUES ($1, 'c', 'l', '{}', 'in_progress', now())", [A]],
        ["INSERT INTO lesson_progress_lesson_resets (user_id, course_slug, lesson_id) VALUES ($1, 'c', 'l')", [A]],
        ["INSERT INTO xp_awards (user_id, source, item_key, milestone, xp) VALUES ($1, 'lesson', 'c/l', 'start', 10)", [A]],
        [`INSERT INTO learning_days (user_id, day) VALUES ($1, ${today})`, [A]],
        // Phase 6 (migration 020): a review card (a lesson prior, reviewed once) and its review.
        [`INSERT INTO review_cards (user_id, course_slug, lesson_id, card_id, learned_at, prior_rating, stability, difficulty, due_day, reps, last_rating, last_review_day)
          VALUES ($1, 'c', 'l', 'card-a', now() - interval '3 days', 3, 10.9, 2.1, ${today} + 11, 1, 3, ${today})`, [A]],
        ["INSERT INTO review_log (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source) VALUES ($1, 'c', 'l', 'card-a', 3, 3, 11, 10.9, 2.1, 'web')", [A]],
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
        lessonProgress: await n('SELECT count(*) AS n FROM lesson_progress WHERE user_id = $1'),
        lessonResets: await n('SELECT count(*) AS n FROM lesson_progress_lesson_resets WHERE user_id = $1'),
        xpAwards: await n('SELECT count(*) AS n FROM xp_awards WHERE user_id = $1'),
        learningDays: await n('SELECT count(*) AS n FROM learning_days WHERE user_id = $1'),
        reviewCards: await n('SELECT count(*) AS n FROM review_cards WHERE user_id = $1'),
        reviewLog: await n('SELECT count(*) AS n FROM review_log WHERE user_id = $1'),
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
        lessonProgress: 0, lessonResets: 0, xpAwards: 0, learningDays: 0, reviewCards: 0, reviewLog: 0,
        safetyKept: 1, billingKept: 1, usageA: 'true', ipKept: 1, acceptanceMarked: 1, acceptanceLive: 0, consents: 0, consentProofs: 1,
        provision: 'used', tombstone: 'staff/null',
    };
    const wrong = Object.keys(want).filter((k) => got[k] !== want[k]);
    check('R6', wrong.length === 0 && paths.length === 1,
        wrong.length ? `after the deletion, unexpected: ${wrong.map((k) => `${k}=${got[k]} (want ${want[k]})`).join(', ')}`
            : 'a seeded learner deleted in one transaction (upper-case id): own rows gone (lesson progress, reset rows, XP awards, learning days, review cards and the review log too), B\'s version kept with created_by NULL, jobs A 0 / B 1, today\'s usage row kept, proofs copied (1 consent, the used grant only), acceptance marked, stub 0');
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

/** The acceptance transaction of the legal routes (design §4.4), on its own client. */
const ACCEPT_LOCKED = `INSERT INTO legal_acceptances (user_id, terms_version, privacy_version)
    SELECT $1::uuid, $2, $3 WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid)
    ON CONFLICT (user_id, terms_version, privacy_version) WHERE account_deleted_at IS NULL DO NOTHING
    RETURNING accepted_at`;

/**
 * Runs the acceptance on `client` (BEGIN … COMMIT), with or without the shared account lock, and
 * holds holdMs before COMMIT. Returns how long the lock (or the insert) waited, the rows inserted
 * and whether a not re-opened tombstone was seen (the 401 account_deleted path).
 * @param {pg.PoolClient} client @param {string} id @param {{ lock: boolean, holdMs?: number, terms: string, privacy: string }} options
 */
async function acceptance(client, id, { lock, holdMs = 0, terms, privacy }) {
    await client.query('BEGIN');
    try {
        const t0 = Date.now();
        if (lock) await client.query(`SELECT pg_advisory_xact_lock_shared(${accountLockKey(1)})`, [id]);
        const inserted = (await client.query(ACCEPT_LOCKED, [id, terms, privacy])).rowCount ?? 0;
        const waited = Date.now() - t0;
        const tombstone = (await client.query('SELECT 1 FROM account_deletions WHERE user_id = $1::uuid AND reopened_at IS NULL', [id])).rowCount ?? 0;
        if (holdMs) await client.query('SELECT pg_sleep($1)', [holdMs / 1000]);
        await client.query('COMMIT');
        return { inserted, waited, deletedSeen: tombstone === 1 };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

/**
 * A pool for deleteAccountData whose transaction holds holdMs after DELETE FROM auth.users (before
 * COMMIT), so another session can run into the deletion while it holds the account lock.
 * @param {pg.Pool} pool @param {number} holdMs
 */
const holdingPool = (pool, holdMs) => ({
    query: (/** @type {string} */ sql, /** @type {unknown[]} */ params) => pool.query(sql, params),
    connect: async () => {
        const client = await pool.connect();
        return {
            query: async (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
                const result = await client.query(sql, params);
                if (sql === DELETION_SQL.deleteStub && holdMs) await client.query('SELECT pg_sleep($1)', [holdMs / 1000]);
                return result;
            },
            release: (/** @type {any} */ error) => client.release(error),
        };
    },
});

/** The row locks the deletion takes right after the account lock (finding: proofs lost to a write in between). */
const ROW_LOCKS = () => /** @type {string[]} */ ([DELETION_SQL.lockStub, DELETION_SQL.lockConsents, DELETION_SQL.lockGrants]);

/**
 * A pool for deleteAccountData whose transaction pauses just before DELETE FROM auth.users (after
 * the copies; nothing committed) until `gate` resolves; reached() is called there. skipRowLocks:
 * the control without the stub, consent and grant row locks.
 * @param {pg.Pool} pool @param {{ gate?: Promise<void>, reached?: () => void, skipRowLocks?: boolean }} options
 */
const gatedPool = (pool, { gate, reached, skipRowLocks = false }) => ({
    query: (/** @type {string} */ sql, /** @type {unknown[]} */ params) => pool.query(sql, params),
    connect: async () => {
        const client = await pool.connect();
        return {
            query: async (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
                if (skipRowLocks && ROW_LOCKS().includes(sql)) return { rows: [], rowCount: 0 };
                if (sql === DELETION_SQL.deleteStub && gate) {
                    reached?.();
                    await gate;
                }
                return client.query(sql, params);
            },
            release: (/** @type {any} */ error) => client.release(error),
        };
    },
});

/** A gate the test opens: { gate, open, reached, whenReached }. */
const makeGate = () => {
    /** @type {() => void} */
    let open = () => {};
    /** @type {() => void} */
    let reached = () => {};
    const gate = new Promise((resolve) => { open = () => resolve(undefined); });
    const whenReached = new Promise((resolve) => { reached = () => resolve(undefined); });
    return { gate, open, reached, whenReached };
};

/**
 * Waits (up to 5 s) until a session's statement matching `pattern` (ILIKE) waits on a lock.
 * @param {pg.Pool} pool @param {string} pattern
 */
async function waitsOnLock(pool, pattern) {
    for (let i = 0; i < 200; i += 1) {
        const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE $1 AND pid <> pg_backend_pid()", [pattern]);
        if (rows.length) return true;
        await sleep(25);
    }
    return false;
}

/** mcp-server/remote.js TOUCH_SQL: an AI app's call through mcp-public (a first use inserts the grant row). */
const TOUCH_GRANT = `INSERT INTO mcp_oauth_grants (user_id, client_id) VALUES ($1, $2)
ON CONFLICT (user_id, client_id) DO UPDATE SET first_seen_at = COALESCE(mcp_oauth_grants.first_seen_at, now()), last_used_at = now()`;
const PAPER_CONSENT = "INSERT INTO account_consents (user_id, kind, policy_version, method, relationship) VALUES ($1, 'guardian_ai', 'guardian-ai-2026-10', 'staff_paper_form', 'parent')";

/** @param {pg.Pool} pool */
async function r9(pool) {
    const terms = 'terms-draft-2026-10-01';
    const privacy = 'privacy-draft-2026-10-01';
    const today = "(now() AT TIME ZONE 'Asia/Tokyo')::date";
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-verify-'));
    /** @type {string[]} */
    const lines = [];
    const service = (/** @type {any} */ p, /** @type {string} */ userId) => deleteAccountData({
        pool: p,
        userId,
        requestedBy: 'self',
        authTime: null,
        billing: { config: null, stripe: null },
        logger: { log: (line) => lines.push(line), warn: (line) => lines.push(line) },
        uploadRoot,
        memory: { enabled: () => false, purge: async () => ({ ok: true }) },
        invalidateCaches: () => {},
    });
    const seed = async (/** @type {string} */ id, /** @type {string} */ other) => {
        const [G1, G2] = ['g1', 'g2'].map(uid);
        const rows = [
            ['INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]],
            ['INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [other]],
            ["INSERT INTO account_consents (user_id, kind, policy_version, method, relationship) VALUES ($1, 'guardian_ai', 'guardian-ai-2026-10', 'guardian_on_device', 'parent')", [id]],
            ["INSERT INTO mcp_oauth_grants (user_id, client_id, client_name, first_seen_at, last_used_at) VALUES ($1, $2, 'used app', now() - interval '3 days', now())", [id, G1]],
            // As server/routes/connectedApps.js writes a revoked app that never called the endpoint.
            ["INSERT INTO mcp_oauth_grants (user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at) VALUES ($1, $2, 'never used', NULL, NULL, now())", [id, G2]],
            ["INSERT INTO jobs (user_id, type, status) VALUES ($1, 'ingest', 'running'), ($2, 'ingest', 'done')", [id, other]],
            ["INSERT INTO materials (user_id, type, storage_path) VALUES ($1, 'txt', 'public/uploads/1700000000000-r9.txt')", [id]],
            [`INSERT INTO ai_daily_usage (usage_day, kind, subject, count) VALUES (${today}, 'llm', $1, 3), (${today} - 3, 'llm', $1, 2)`, [id]],
            ["INSERT INTO legal_document_versions (version, document, sha256) VALUES ($1, 'terms', repeat('a', 64)), ($2, 'privacy', repeat('b', 64)) ON CONFLICT DO NOTHING", [terms, privacy]],
        ];
        for (const [sql, params] of rows) await pool.query(/** @type {string} */ (sql), /** @type {unknown[]} */ (params));
    };
    const n = async (/** @type {string} */ sql, /** @type {unknown[]} */ params) => count(pool, sql, params);
    /**
     * The proof rows of `id` (marked acceptances, consent proofs, provision records), how many of them
     * differ from the tombstone's deleted_at (compared in the database, to the microsecond), and the
     * tombstone's microseconds.
     * @param {string} id
     */
    const proofTimes = async (id) => {
        const { rows: [row] } = await pool.query(`SELECT
              (SELECT count(*) FROM legal_acceptances x WHERE x.user_id = d.user_id AND x.account_deleted_at IS NOT NULL)::int
            + (SELECT count(*) FROM account_consent_proofs x WHERE x.user_id = d.user_id)::int
            + (SELECT count(*) FROM ai_app_provision_records x WHERE x.user_id = d.user_id)::int AS proofs,
              (SELECT count(*) FROM legal_acceptances x WHERE x.user_id = d.user_id AND x.account_deleted_at IS NOT NULL AND x.account_deleted_at <> d.deleted_at)::int
            + (SELECT count(*) FROM account_consent_proofs x WHERE x.user_id = d.user_id AND x.account_deleted_at <> d.deleted_at)::int
            + (SELECT count(*) FROM ai_app_provision_records x WHERE x.user_id = d.user_id AND x.account_deleted_at <> d.deleted_at)::int AS off,
            to_char(d.deleted_at, 'US') AS us
            FROM account_deletions d WHERE d.user_id = $1::uuid`, [id]);
        return row ?? { proofs: 0, off: 0, us: null };
    };
    try {
        // R9a: the service (upper-case id) holds the lock; an acceptance LEAD_MS later waits and inserts nothing.
        {
            const A = uid('r9a');
            const B = uid('r9b');
            await seed(A, B);
            const running = service(holdingPool(pool, HOLD_MS), A.toUpperCase());
            await sleep(LEAD_MS);
            const c2 = await pool.connect();
            let accepted;
            try {
                accepted = await acceptance(c2, A, { lock: true, terms, privacy });
            } finally {
                c2.release();
            }
            const result = await running;
            const got = {
                result: result.status,
                live: await n('SELECT count(*) AS n FROM legal_acceptances WHERE user_id = $1 AND account_deleted_at IS NULL', [A]),
                stub: await n('SELECT count(*) AS n FROM auth.users WHERE id = $1', [A]),
                consentProofs: await n("SELECT count(*) AS n FROM account_consent_proofs WHERE user_id = $1 AND policy_version = 'guardian-ai-2026-10'", [A]),
                provision: (await pool.query('SELECT client_name FROM ai_app_provision_records WHERE user_id = $1', [A])).rows.map((r) => r.client_name).join(),
                usageToday: await n(`SELECT count(*) AS n FROM ai_daily_usage WHERE subject = $1 AND usage_day = ${today}`, [A]),
                usageOlder: await n(`SELECT count(*) AS n FROM ai_daily_usage WHERE subject = $1 AND usage_day < ${today}`, [A]),
                consents: await n('SELECT count(*) AS n FROM account_consents WHERE user_id = $1', [A]),
                jobsA: await n('SELECT count(*) AS n FROM jobs WHERE user_id = $1', [A]),
                jobsB: await n('SELECT count(*) AS n FROM jobs WHERE user_id = $1', [B]),
                tombstone: (await pool.query('SELECT requested_by, reopened_at FROM account_deletions WHERE user_id = $1', [A])).rows.map((r) => `${r.requested_by}/${r.reopened_at}`).join(),
            };
            const want = { result: 'deleted', live: 0, stub: 0, consentProofs: 1, provision: 'used app', usageToday: 1, usageOlder: 0, consents: 0, jobsA: 0, jobsB: 1, tombstone: 'self/null' };
            const wrong = Object.keys(want).filter((k) => got[k] !== want[k]);
            check('R9', accepted.waited >= BLOCKED_MS && accepted.inserted === 0 && accepted.deletedSeen && wrong.length === 0,
                wrong.length ? `unexpected after the service: ${wrong.map((k) => `${k}=${got[k]} (want ${want[k]})`).join(', ')}`
                    : `an acceptance during the service waited ${accepted.waited} ms, inserted ${accepted.inserted}, saw the tombstone (401 path); after: live acceptances 0, stub 0, 1 consent proof, the used grant only, today's usage kept, jobs A 0 / B 1`);
            const timesA = await proofTimes(A);
            check('R9', timesA.proofs === 2 && timesA.off === 0,
                `the consent proof and the provision record carry the tombstone's deleted_at exactly (${timesA.proofs} proof rows, ${timesA.off} off; tombstone microseconds ${timesA.us})`);
            const done = lines.find((l) => l.startsWith('[Account] Rise Path data deleted for '));
            check('R9', Boolean(done && /^\[Account\] Rise Path data deleted for [0-9a-f]{8}… \(self; files 1\/1; memory skipped\) in \d+ms$/.test(done) && !done.includes(A)),
                `the service's one log line: ${done}`);
            const again = await service(pool, A);
            check('R9', again.status === 'already', `a second call answers ${again.status}`);
        }
        // R9 control: the same acceptance without the shared lock leaves a live row for the deleted account.
        {
            const C = uid('r9c');
            await seed(C, uid('r9x'));
            const running = service(holdingPool(pool, HOLD_MS), C);
            await sleep(LEAD_MS);
            const c2 = await pool.connect();
            let accepted;
            try {
                accepted = await acceptance(c2, C, { lock: false, terms, privacy });
            } finally {
                c2.release();
            }
            const result = await running;
            const live = await n('SELECT count(*) AS n FROM legal_acceptances WHERE user_id = $1 AND account_deleted_at IS NULL', [C]);
            check('R9', result.status === 'deleted' && accepted.inserted === 1 && live === 1,
                `control, acceptance without the shared lock: inserted ${accepted.inserted}, live acceptances after the deletion ${live} (the lock is needed)`);
        }
        // R9b: an acceptance that started first holds the shared lock; the service waits, then marks its row.
        {
            const D = uid('r9d');
            await seed(D, uid('r9y'));
            const c1 = await pool.connect();
            let accepted;
            let result;
            let waited = 0;
            try {
                const holding = acceptance(c1, D, { lock: true, holdMs: HOLD_MS, terms, privacy });
                await sleep(LEAD_MS);
                const t0 = Date.now();
                result = await service(pool, D);
                waited = Date.now() - t0;
                accepted = await holding;
            } finally {
                c1.release();
            }
            const marked = await n('SELECT count(*) AS n FROM legal_acceptances WHERE user_id = $1 AND account_deleted_at IS NOT NULL', [D]);
            const live = await n('SELECT count(*) AS n FROM legal_acceptances WHERE user_id = $1 AND account_deleted_at IS NULL', [D]);
            check('R9', result?.status === 'deleted' && accepted?.inserted === 1 && waited >= BLOCKED_MS && marked === 1 && live === 0,
                `an acceptance started first: the service waited ${waited} ms for it, then marked its row (marked ${marked}, live ${live})`);
            const timesD = await proofTimes(D);
            check('R9', timesD.proofs === 3 && timesD.off === 0,
                `the marked acceptance and both copies carry the tombstone's deleted_at exactly (${timesD.proofs} proof rows, ${timesD.off} off; tombstone microseconds ${timesD.us})`);
        }
        // R9e: the plan rows by Stripe mode ($2 = the api is live). A live api leaves a test-mode row
        // out (it never syncs one again); a live row counts on either; then the service on a live api.
        {
            const E = uid('r9e');
            const F = uid('r9f');
            await seed(E, F);
            const sub = (/** @type {string} */ user, /** @type {boolean} */ livemode) => pool.query(
                "INSERT INTO billing_subscriptions (stripe_subscription_id, stripe_customer_id, user_id, status, livemode, synced_at) VALUES ($1, $2, $3, 'active', $4, now())",
                [`sub_${livemode ? 'live' : 'test'}_${user}`, `cus_${user}`, user, livemode]);
            await sub(E, false);
            await sub(F, true);
            const rows = async (/** @type {string} */ sql, /** @type {string} */ id, /** @type {boolean} */ live) => (await pool.query(sql, [id, live])).rows.length;
            const got = [
                await rows(DELETION_SQL.renewingLocal, E, true), await rows(DELETION_SQL.renewingLocal, E, false),
                await rows(DELETION_SQL.renewingLocal, F, true), await rows(DELETION_SQL.renewingLocal, F, false),
                await rows(DELETION_SQL.openSubscriptions, E, true), await rows(DELETION_SQL.openSubscriptions, E, false),
            ].join(' ');
            check('R9', got === '0 1 1 1 0 1', `plan rows (test-mode row on a live / a test api, live row on a live / a test api, preflight test-mode row live / test): ${got} (want 0 1 1 1 0 1)`);
            // No billing_customers rows for E and F, so the client object is never called.
            const liveApi = { config: { live: true }, stripe: /** @type {any} */ ({}) };
            const onLive = (/** @type {string} */ userId) => deleteAccountData({
                pool, userId, requestedBy: 'staff', authTime: null, billing: liveApi, uploadRoot,
                logger: { log: () => {}, warn: () => {} }, memory: { enabled: () => false, purge: async () => ({ ok: true }) }, invalidateCaches: () => {},
            });
            const [e, f] = [await onLive(E), await onLive(F)];
            const kept = await n('SELECT count(*) AS n FROM billing_subscriptions WHERE stripe_subscription_id = $1 AND user_id IS NULL', [`sub_test_${E}`]);
            const stubs = [await n('SELECT count(*) AS n FROM auth.users WHERE id = $1', [E]), await n('SELECT count(*) AS n FROM auth.users WHERE id = $1', [F])].join('/');
            check('R9', e.status === 'deleted' && f.status === 'refused' && 'reason' in f && f.reason === 'subscription_active' && kept === 1 && stubs === '0/1',
                `a live api: the tester's test-mode row ${e.status} (row kept, unlinked ${kept}), the live row ${f.status}${'reason' in f ? `/${f.reason}` : ''}; stubs E/F ${stubs}`);
        }
        const methods = async (/** @type {string} */ id) => (await pool.query('SELECT method FROM account_consent_proofs WHERE user_id = $1 ORDER BY method', [id])).rows.map((r) => r.method).join(',');
        // R9f: a paper consent whose INSERT runs (its FK check holds KEY SHARE on the stub) but has not
        // committed when the deletion starts: the deletion waits at the stub lock, then copies it.
        for (const skipRowLocks of [false, true]) {
            const F = uid(skipRowLocks ? 'r9h' : 'r9f');
            await seed(F, uid('r9z'));
            const c2 = await pool.connect();
            /** @type {{ status: string } | undefined} */
            let result;
            let finishedEarly = false;
            try {
                await c2.query('BEGIN');
                await c2.query(PAPER_CONSENT, [F]);
                const running = service(gatedPool(pool, { skipRowLocks }), F).then((r) => {
                    result = r;
                    return r;
                });
                await sleep(HOLD_MS);
                finishedEarly = result !== undefined;
                await c2.query('COMMIT');
                await running;
            } finally {
                c2.release();
            }
            const got = await methods(F);
            if (!skipRowLocks) {
                check('R9', result?.status === 'deleted' && !finishedEarly && got === 'guardian_on_device,staff_paper_form',
                    `a consent INSERT in flight when the deletion starts: the deletion was still waiting after ${HOLD_MS} ms (${!finishedEarly}), then copied both consents (proofs ${got})`);
            } else {
                check('R9', result?.status === 'deleted' && got === 'guardian_on_device',
                    `control, without the row locks: the in-flight consent is cascaded with no proof (proofs ${got}; the locks are needed)`);
            }
        }
        // R9g: the deletion paused between its copies and the stub DELETE; meanwhile a paper consent, a
        // first-use grant and the first use of a revoked never-used grant row (G2 of the seed) arrive.
        for (const skipRowLocks of [false, true]) {
            const G = uid(skipRowLocks ? 'r9j' : 'r9g');
            await seed(G, uid('r9w'));
            const [NEW_APP, NAMELESS] = [uid('r9n'), uid('r9m')];
            // A used grant as mcp-server/remote.js writes it (no name); the page sends its name.
            await pool.query("INSERT INTO mcp_oauth_grants (user_id, client_id, first_seen_at, last_used_at) VALUES ($1, $2, now() - interval '2 days', now())", [G, NAMELESS]);
            const revokedNeverUsed = (await pool.query("SELECT client_id FROM mcp_oauth_grants WHERE user_id = $1 AND client_name = 'never used'", [G])).rows[0].client_id;
            const { gate, open, reached, whenReached } = makeGate();
            const running = deleteAccountData({
                pool: gatedPool(pool, { gate, reached, skipRowLocks }), userId: G, requestedBy: 'self', authTime: null,
                appNames: [{ clientId: NAMELESS, clientName: 'Claude Code' }],
                billing: { config: null, stripe: null }, logger: { log: () => {}, warn: () => {} }, uploadRoot,
                memory: { enabled: () => false, purge: async () => ({ ok: true }) }, invalidateCaches: () => {},
            });
            await whenReached;
            const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
            /** @type {string[]} */
            let writes = [];
            let blocked = false;
            try {
                const outcome = (/** @type {Promise<unknown>} */ p) => p.then(() => 'committed', (error) => String(error?.code ?? 'error'));
                const pending = Promise.all([
                    outcome(clients[0].query(PAPER_CONSENT, [G])),
                    outcome(clients[1].query(TOUCH_GRANT, [G, NEW_APP])),
                    outcome(clients[2].query(TOUCH_GRANT, [G, revokedNeverUsed])),
                ]);
                if (!skipRowLocks) blocked = await waitsOnLock(pool, '%INSERT INTO account_consents%') && await waitsOnLock(pool, '%INSERT INTO mcp_oauth_grants%');
                else writes = await pending;
                open();
                if (!skipRowLocks) writes = await pending;
            } finally {
                for (const c of clients) c.release();
            }
            const result = await running;
            const got = {
                proofs: await methods(G),
                provision: (await pool.query('SELECT client_id::text AS id, client_name FROM ai_app_provision_records WHERE user_id = $1 ORDER BY client_name', [G])).rows
                    .map((r) => (r.id === NEW_APP ? 'new app' : r.id === revokedNeverUsed ? 'revoked app' : r.client_name)).join(','),
                left: await n('SELECT (SELECT count(*) FROM account_consents WHERE user_id = $1) + (SELECT count(*) FROM mcp_oauth_grants WHERE user_id = $1) AS n', [G]),
            };
            if (!skipRowLocks) {
                check('R9', result.status === 'deleted' && blocked && writes.join() === '23503,23503,23503' && got.proofs === 'guardian_on_device' && got.provision === 'Claude Code,used app' && got.left === 0,
                    `writes while the deletion sits between its copies and the stub: they waited (${blocked}) and then failed their foreign key (${writes.join(', ')}); proofs ${got.proofs}, provision records ${got.provision} (the page's name for the nameless grant), nothing left ${got.left}`);
            } else {
                check('R9', result.status === 'deleted' && writes.join() === 'committed,committed,committed' && got.proofs === 'guardian_on_device' && !got.provision.includes('new app') && !got.provision.includes('revoked app'),
                    `control, without the row locks: the writes committed (${writes.join(', ')}) and were cascaded with no proof (proofs ${got.proofs}, provision ${got.provision}; the locks are needed)`);
            }
        }
    } finally {
        await fs.rm(uploadRoot, { recursive: true, force: true });
    }
}

/** @param {pg.Pool} pool */
async function r10(pool) {
    const today = "(now() AT TIME ZONE 'Asia/Tokyo')::date";
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-verify-retention-'));
    /** @type {string[]} */
    const lines = [];
    const logger = { log: (/** @type {string} */ line) => lines.push(line), warn: (/** @type {string} */ line) => lines.push(line) };
    const n = async (/** @type {string} */ sql, /** @type {unknown[]} */ params = []) => count(pool, sql, params);
    try {
        const C = uid('r10c');
        const [S1, S2] = [uid('r10s'), uid('r10t')];
        const tag = `r10-${C.slice(-6)}`;
        const terms = 'terms-draft-2026-10-02';
        const privacy = 'privacy-draft-2026-10-02';
        const [gone, kept] = [uid('r10g'), uid('r10k')];
        const rows = [
            ['INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [C]],
            // Usage counts: today, 30 days before (kept) and 31 days before (deleted), for an id, an ip: subject and the total.
            [`INSERT INTO ai_daily_usage (usage_day, kind, subject, count)
              SELECT ${today} - d, 'llm', s, 1 FROM unnest(ARRAY[0, 30, 31]) AS d, unnest(ARRAY[$1, 'ip:${tag}', '*${tag}']) AS s`, [C]],
            // 12001 counts of one old day: three batches of BATCH_LIMIT.
            [`INSERT INTO ai_daily_usage (usage_day, kind, subject, count) SELECT ${today} - 40, 'llm', 'ip:${tag}-' || g, 1 FROM generate_series(1, 12001) g`, []],
            // Jobs of C: 400 days old in every status, and one left running 10 days ago.
            ["INSERT INTO jobs (user_id, type, status, updated_at) VALUES ($1, 'ingest', 'running', now() - interval '400 days'), ($1, 'ingest', 'queued', now() - interval '400 days'), ($1, 'ingest', 'done', now() - interval '400 days'), ($1, 'ingest', 'error', now() - interval '400 days'), ($1, 'ingest', 'running', now() - interval '10 days')", [C]],
            // MCP: an old session (with a tool call of its own), a recent one, an old and a recent call without a session.
            ["INSERT INTO mcp_sessions (id, user_id, started_at) VALUES ($1, $3, now() - interval '400 days'), ($2, $3, now() - interval '10 days')", [S1, S2, C]],
            ["INSERT INTO mcp_tool_calls (session_id, tool_name, created_at) VALUES ($1, 'r10-old-session', now() - interval '400 days'), ($2, 'r10-recent-session', now() - interval '10 days'), (NULL, 'r10-old', now() - interval '400 days'), (NULL, 'r10-recent', now() - interval '10 days')", [S1, S2]],
            // The proofs of two deleted accounts: one deleted 5 years + 1 day ago (3 years + 1 day for the AI-app record), one a day short.
            ["INSERT INTO legal_document_versions (version, document, sha256) VALUES ($1, 'terms', repeat('c', 64)), ($2, 'privacy', repeat('d', 64)) ON CONFLICT DO NOTHING", [terms, privacy]],
            [`INSERT INTO legal_acceptances (user_id, terms_version, privacy_version, accepted_at, account_deleted_at) VALUES
              ($1, $3, $4, now() - interval '5 years 2 days', now() - interval '5 years 1 day'),
              ($2, $3, $4, now() - interval '5 years', now() - interval '5 years' + interval '1 day'),
              ($5, $3, $4, now() - interval '6 years', NULL)`, [gone, kept, terms, privacy, C]],
            [`INSERT INTO account_consent_proofs (consent_id, user_id, kind, policy_version, method, given_at, account_deleted_at) VALUES
              (gen_random_uuid(), $1, 'guardian_ai', 'guardian-ai-2026-10', 'guardian_on_device', now() - interval '6 years', now() - interval '5 years 1 day'),
              (gen_random_uuid(), $2, 'guardian_ai', 'guardian-ai-2026-10', 'guardian_on_device', now() - interval '6 years', now() - interval '5 years' + interval '1 day')`, [gone, kept]],
            [`INSERT INTO ai_app_provision_records (user_id, client_id, client_name, account_deleted_at) VALUES
              ($1, gen_random_uuid(), 'old app', now() - interval '3 years 1 day'),
              ($2, gen_random_uuid(), 'recent app', now() - interval '3 years' + interval '1 day')`, [gone, kept]],
            [`INSERT INTO account_deletions (user_id, deleted_at, requested_by) VALUES
              ($1, now() - interval '5 years 1 day', 'self'), ($2, now() - interval '5 years' + interval '1 day', 'staff')`, [gone, kept]],
            ["INSERT INTO materials (user_id, type, storage_path) VALUES ($1, 'txt', 'public/uploads/1700000000001-r10-referenced.txt')", [C]],
        ];
        for (const [sql, params] of rows) await pool.query(/** @type {string} */ (sql), /** @type {unknown[]} */ (params));
        const dir = path.join(uploadRoot, 'public', 'uploads');
        await fs.mkdir(dir, { recursive: true });
        const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
        for (const name of ['1700000000000-r10-orphan.txt', '1700000000001-r10-referenced.txt', '1700000000002-r10-fresh.txt']) {
            await fs.writeFile(path.join(dir, name), 'x');
            if (!name.includes('fresh')) await fs.utimes(path.join(dir, name), old, old);
        }
        const snapshot = async () => ({
            usage: (await pool.query(`SELECT string_agg((${today} - usage_day)::text, ',' ORDER BY usage_day DESC) AS days FROM (SELECT DISTINCT usage_day FROM ai_daily_usage WHERE subject IN ($1, 'ip:${tag}', '*${tag}')) d`, [C])).rows[0].days,
            bulk: await n(`SELECT count(*) AS n FROM ai_daily_usage WHERE subject LIKE 'ip:${tag}-%'`),
            jobs: (await pool.query("SELECT string_agg(status, ',' ORDER BY status) AS s FROM jobs WHERE user_id = $1", [C])).rows[0].s,
            sessions: await n('SELECT count(*) AS n FROM mcp_sessions WHERE id IN ($1, $2)', [S1, S2]),
            calls: (await pool.query("SELECT string_agg(tool_name, ',' ORDER BY tool_name) AS s FROM mcp_tool_calls WHERE tool_name LIKE 'r10-%'")).rows[0].s,
            acceptances: (await pool.query(`SELECT string_agg(who, ',' ORDER BY who) AS s FROM (SELECT CASE user_id WHEN $1::uuid THEN 'gone' WHEN $2::uuid THEN 'kept' ELSE 'live' END AS who
                FROM legal_acceptances WHERE user_id IN ($1, $2, $3)) a`, [gone, kept, C])).rows[0].s,
            consents: (await pool.query("SELECT string_agg(CASE user_id WHEN $1::uuid THEN 'gone' ELSE 'kept' END, ',') AS s FROM account_consent_proofs WHERE user_id IN ($1, $2)", [gone, kept])).rows[0].s,
            apps: (await pool.query("SELECT string_agg(client_name, ',') AS s FROM ai_app_provision_records WHERE user_id IN ($1, $2)", [gone, kept])).rows[0].s,
            tombstones: (await pool.query("SELECT string_agg(requested_by, ',') AS s FROM account_deletions WHERE user_id IN ($1, $2)", [gone, kept])).rows[0].s,
            files: (await fs.readdir(dir)).sort().join(','),
        });
        const before = await snapshot();
        const config = readRetentionConfig({});

        // The lock held by another session (a second api container): the run deletes nothing.
        const holder = await pool.connect();
        let blocked;
        try {
            await holder.query(RETENTION_LOCK_SQL);
            blocked = await runRetention({ pool: /** @type {any} */ (pool), config, logger, uploadRoot });
        } finally {
            await holder.query("SELECT pg_advisory_unlock(hashtextextended('risepath:retention', 0))").catch(() => {});
            holder.release();
        }
        const whileLocked = await snapshot();
        check('R10', blocked.ran === false && JSON.stringify(whileLocked) === JSON.stringify(before),
            `while another session holds the retention lock: ran ${blocked.ran}, nothing deleted (${JSON.stringify(whileLocked) === JSON.stringify(before)})`);

        const result = await runRetention({ pool: /** @type {any} */ (pool), config, logger, uploadRoot });
        const after = await snapshot();
        const want = {
            usage: '0,30', bulk: 0, jobs: 'running', sessions: 1, calls: 'r10-recent,r10-recent-session',
            acceptances: 'kept,live', consents: 'kept', apps: 'recent app', tombstones: 'staff',
            files: '1700000000001-r10-referenced.txt,1700000000002-r10-fresh.txt',
        };
        const wrong = Object.keys(want).filter((k) => /** @type {any} */ (after)[k] !== /** @type {any} */ (want)[k]);
        check('R10', result.ran === true && wrong.length === 0,
            wrong.length ? `unexpected after the run: ${wrong.map((k) => `${k}=${/** @type {any} */ (after)[k]} (want ${/** @type {any} */ (want)[k]})`).join(', ')}`
                : `usage days left ${after.usage} (today and 30 days before), jobs left: the one running 10 days ago (400-day-old running/queued/done/error gone), MCP: the old session with its call and the old call gone, `
                + 'proofs deleted 5 years + 1 day ago gone and those a day short kept (live acceptance kept), AI-app record 3 years + 1 day gone, the old tombstone gone, the orphan file gone (referenced and fresh kept)');
        const deleted = result.deleted;
        check('R10', deleted.ai_daily_usage >= 12001 + 3 && deleted.jobs >= 4 && deleted.uploads === 1 && deleted.account_deletions >= 1,
            `counts: ai_daily_usage=${deleted.ai_daily_usage} (≥ 12004, ${Math.ceil(deleted.ai_daily_usage / BATCH_LIMIT)} batches of ${BATCH_LIMIT}) jobs=${deleted.jobs} mcp_tool_calls=${deleted.mcp_tool_calls} mcp_sessions=${deleted.mcp_sessions} `
            + `legal_acceptances=${deleted.legal_acceptances} account_consent_proofs=${deleted.account_consent_proofs} ai_app_provision_records=${deleted.ai_app_provision_records} account_deletions=${deleted.account_deletions} uploads=${deleted.uploads}`);
        const summary = lines.find((line) => line.startsWith('[Retention] deleted '));
        check('R10', Boolean(summary) && !lines.some((line) => line.includes('failed')) && !lines.some((line) => line.includes(C) || line.includes(gone)),
            `one summary line, no failed step, no id: ${summary}`);
        const again = await runRetention({ pool: /** @type {any} */ (pool), config, logger, uploadRoot });
        check('R10', again.ran === true && Object.values(again.deleted).every((v) => v === 0),
            `a second run deletes nothing (${Object.values(again.deleted).reduce((a, b) => a + b, 0)} rows)`);

        // R10b: a tombstone past its period (deleted 6 years ago, re-opened 5.5 years ago) whose account
        // is deleted again while the run's DELETE FROM account_deletions waits on the row lock. READ
        // COMMITTED re-checks only the target row's own WHERE on the new row version: the age test
        // must be there. Control: the statement without it deletes the fresh tombstone.
        const OLD_TOMBSTONE_SQL = 'DELETE FROM account_deletions WHERE user_id IN (SELECT user_id FROM account_deletions WHERE deleted_at < now() - make_interval(years => $1) LIMIT $2)';
        for (const control of [false, true]) {
            const T = uid(control ? 'r10x' : 'r10r');
            await pool.query("INSERT INTO account_deletions (user_id, deleted_at, requested_by, reopened_at) VALUES ($1, now() - interval '6 years', 'self', now() - interval '5 years 6 months')", [T]);
            await pool.query('INSERT INTO auth.users (id) VALUES ($1)', [T]);
            const { gate, open, reached, whenReached } = makeGate();
            const deletion = deleteAccountData({
                pool: gatedPool(pool, { gate, reached }), userId: T, requestedBy: 'staff', authTime: null,
                billing: { config: null, stripe: null }, logger: { log: () => {}, warn: () => {} }, uploadRoot,
                memory: { enabled: () => false, purge: async () => ({ ok: true }) }, invalidateCaches: () => {},
            });
            await whenReached; // the tombstone is rewritten (deleted_at now, reopened_at NULL), not committed
            const sweep = control
                ? pool.query(OLD_TOMBSTONE_SQL, [5, BATCH_LIMIT]).then((r) => r.rowCount ?? 0)
                : runRetention({ pool: /** @type {any} */ (pool), config, logger, uploadRoot }).then((r) => r.deleted.account_deletions);
            const waited = await waitsOnLock(pool, '%DELETE FROM account_deletions%');
            open();
            const done = await deletion;
            const swept = await sweep;
            const row = (await pool.query("SELECT deleted_at > now() - interval '1 minute' AS fresh, reopened_at FROM account_deletions WHERE user_id = $1", [T])).rows[0];
            const state = await readAccountState(pool, T, Math.floor(Date.now() / 1000) - 365 * 86400, { mayReopen: true });
            if (!control) {
                check('R10', done.status === 'deleted' && waited && swept === 0 && row?.fresh === true && row?.reopened_at === null && state.state === 'deleted',
                    `a second deletion of an expired, re-opened tombstone during the run: the run waited on its row (${waited}), deleted ${swept}, the fresh tombstone is kept (${row ? `fresh ${row.fresh}, reopened_at ${row.reopened_at}` : 'gone'}), a session from before it is ${state.state}`);
            } else {
                check('R10', done.status === 'deleted' && waited && swept === 1 && !row && state.state === 'ok',
                    `control, without the outer age test: the run deleted ${swept} row, the fresh tombstone is ${row ? 'kept (unexpected)' : 'gone'} and an old session is ${state.state} (the guard is needed)`);
            }
        }
    } finally {
        await fs.rm(uploadRoot, { recursive: true, force: true });
    }
}

/**
 * The server log as text from `offset` on: --log-file, else the server's own file when the logging
 * collector runs (pg_read_file, superuser). null when neither is available.
 * @param {pg.Pool} pool @param {string} logFile @param {number} [offset]
 */
async function readServerLog(pool, logFile, offset = 0) {
    if (logFile) {
        const handle = await fs.open(logFile, 'r');
        try {
            const { size } = await handle.stat();
            const length = Math.max(0, size - offset);
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, offset);
            return { text: buffer.toString('utf8'), size, source: '--log-file' };
        } finally {
            await handle.close();
        }
    }
    const { rows: [row] } = await pool.query("SELECT pg_current_logfile('stderr') AS file");
    if (!row?.file) return null;
    const { rows: [stat] } = await pool.query('SELECT size FROM pg_stat_file($1)', [row.file]);
    const size = Number(stat.size);
    const { rows: [read] } = await pool.query('SELECT pg_read_file($1, $2, $3) AS text', [row.file, offset, Math.max(0, size - offset)]);
    return { text: String(read.text ?? ''), size, source: 'pg_current_logfile()' };
}

/** @param {pg.Pool} pool @param {string} logFile */
async function r11(pool, logFile) {
    const start = await readServerLog(pool, logFile);
    if (!start) {
        skip('R11', 'the server log is not readable here: pass --log-file <path of the cluster log> or run the cluster with logging_collector=on (--allow-skip accepts the gap)');
        return;
    }
    const nonce = uid('r11').slice(-8);
    const cases = /** @type {const} */ (['default', 'terse']);
    /** @type {Record<string, string>} */
    const ids = {};
    const client = await pool.connect();
    try {
        for (const verbosity of cases) {
            ids[verbosity] = uid(`r11${verbosity[0]}`);
            await client.query(`SET log_error_verbosity = ${verbosity}`);
            // A foreign key refusal with a bound parameter, as the api's statements are sent.
            await client.query(`/* r11-${verbosity}-${nonce} */ INSERT INTO jobs (user_id, type) VALUES ($1::uuid, 'ingest')`, [ids[verbosity]])
                .then(() => { throw new Error('the insert was not refused'); }, (error) => {
                    if (/** @type {any} */ (error)?.code !== '23503') throw error;
                });
        }
        await client.query('RESET log_error_verbosity');
    } finally {
        client.release();
    }
    await sleep(300); // the server writes its log asynchronously
    const log = await readServerLog(pool, logFile, start.size);
    const entries = (log?.text ?? '').split('\n');
    /** The ERROR … STATEMENT lines of one case. @param {string} verbosity */
    const block = (verbosity) => {
        const end = entries.findIndex((line) => line.includes(`STATEMENT:`) && line.includes(`r11-${verbosity}-${nonce}`));
        if (end < 0) return null;
        let begin = end;
        while (begin > 0 && !/\bERROR:/.test(entries[begin])) begin -= 1;
        return entries.slice(begin, end + 1);
    };
    const def = block('default');
    const terse = block('terse');
    const detail = (/** @type {string[] | null} */ b) => Boolean(b?.some((line) => /\bDETAIL:/.test(line)));
    check('R11', Boolean(def) && detail(def) && Boolean(def?.some((line) => line.includes(ids.default))),
        `default verbosity (${log?.source}): the refusal is logged with ${detail(def) ? 'a DETAIL line holding the full id' : 'no DETAIL line (unexpected)'}`);
    const terseText = (terse ?? []).join('\n');
    check('R11', Boolean(terse) && !detail(terse) && !terseText.includes(ids.terse) && /STATEMENT:.*\$1/.test(terseText) && !(log?.text ?? '').includes(ids.terse),
        `log_error_verbosity=terse: ${terse ? `${terse.length} lines (ERROR, STATEMENT with $1), no DETAIL, the id nowhere in the log` : 'no entry found'}`);
}

export async function main(argv = process.argv.slice(2)) {
    const { url, logFile, allowSkip, help } = parseArgs(argv);
    if (help || !url) {
        console.log('Usage: node scripts/db/verify-account-deletion.mjs --url postgres://<user>@<host>:<port>/<empty throwaway database> [--log-file <the cluster log, for R11>] [--allow-skip]');
        console.log('Exit: 0 all passed, 1 a check failed, 2 refused or usage, 3 a check was skipped (without --allow-skip).');
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
        await r9(pool);
        await r10(pool);
        await r11(pool, logFile);
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
    console.log(`# ${results.length - failed.length} passed, ${failed.length} failed${skipped.length ? `, ${skipped.length} skipped (${skipped.join(', ')})` : ''}`);
    const code = exitCode({ failed: failed.length, skipped: skipped.length, allowSkip });
    if (code === 3) console.log('# exit 3: a skipped check is not a pass (give --log-file, or --allow-skip to accept the gap)');
    return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
}
