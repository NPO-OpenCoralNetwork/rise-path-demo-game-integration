#!/usr/bin/env node
// @ts-check
/**
 * Proves migration 019 (Phase 5: one-lesson reset, XP ledger, learning days) and the server code
 * that uses it on a real, THROWAWAY PostgreSQL (16, as the VM's pgvector/pgvector:0.8.7-pg16). npm
 * test pins the SQL text without a database (server/tests/migration019.test.js) and runs the code on
 * in-memory fakes; this script runs the shipped SQL constants and tools/core functions on Postgres,
 * and CI runs it on the VM's image (job "Database checks", scripts/ci/db-checks.sh). It is the Phase 5
 * stage gate and the 確かめ方 of server/migrations/README.md.
 *
 *   createdb -h 127.0.0.1 -p 55461 -U postgres verify_p5
 *   node scripts/db/verify-phase5.mjs --url postgres://postgres@127.0.0.1:55461/verify_p5
 *
 * Same refusals and exit codes as verify-account-deletion.mjs (whose parseArgs and exitCode it
 * uses): exit 2 unless the database has no table in public or auth, the role risepath_mcp_remote
 * does not exist in the cluster, and the user is a superuser; 1 when a check failed; 3 when a check
 * could not run here (P4 without psql) unless --allow-skip. P4 creates risepath_mcp_remote with
 * deploy/risepath-vm/sql/mcp_remote_role.sql (through psql, a random password) and drops it again.
 * The database keeps the test rows: drop it (or the whole cluster) afterwards.
 *
 * Checks (Phase 5 design §7.5):
 *   P1  000–019 apply twice; the three new tables' user_id FKs CASCADE; no other FK on them
 *   P2  the CHECKs refuse a wrong amount, milestone, source, item key or lesson id (23514)
 *   P3  a reset on real rows: a REST save of the old generation started during it waits on the
 *       learner lock and is refused 'lesson_reset'; an MCP course-quiz-check started during it waits
 *       on the row and ends with only its new answer
 *   P4  as risepath_mcp_remote (the shipped role SQL): no privilege on the three tables; the MCP
 *       functions (applyQuizCheck, markLessonProgress, getLessonProgress) work on a restarted lesson;
 *       the REST read with the generations is refused (control)
 *   P5  two reconciles of one learner at once: the second waits on the XP lock, no deadlock, no
 *       duplicate; a reset and a reconcile in both orders: no deadlock. Stage 2: the achievements
 *       read (getAchievements) waits for a reset holding the XP lock and then counts what the reset
 *       kept; reads, the two after-save hooks and a reset all at once: no deadlock, each award once;
 *       the XP lock is one per learner whatever the id's case (a reset sent with the upper-case id
 *       waits for a transaction holding it under the lower-case id)
 *   P6  delete-all keeps the reset rows, the ledger and the days; then the kept generation saves and
 *       null is refused with lessonResetAt and no record. An AI app's write (the MCP writers lock only
 *       their row) that commits while delete-all waits for the row: the row is deleted as written,
 *       with its awards. Control: the earlier order (reconcile, then a plain DELETE) loses 'done'
 *   P7  deleting the stub cascades all three tables; an insert afterwards fails 23503, and the
 *       after-save hooks then only log (false), never throw
 *   P8  the backfill on seeded lesson_progress, user_progress and learning_events: the expected
 *       awards and days (the Japan-time day boundary, never diagnosis or course generation); a
 *       re-run adds nothing; the achievements read then shows exactly the backfill (XP, counts,
 *       days, today from the server clock in Japan time) and adds nothing
 *   P9  every statement of the previous api image (before Phase 5) runs on the migrated schema
 *   P10 a reset and an account deletion (server/services/accountDeletion.js lock, lockStub,
 *       deleteStub) in both orders: no deadlock, the deletion completes; deletion first → the reset
 *       fails 23503. Control: the same interleaving without ACCOUNT_STUB_SHARE_SQL ends in 40P01
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { exitCode, parseArgs } from './verify-account-deletion.mjs';
import { resetPoolForTests, setPoolForTests } from '../../server/db.js';
import { SQL as DELETION_SQL } from '../../server/services/accountDeletion.js';
import {
    ACCOUNT_STUB_SHARE_SQL,
    LEARNER_LOCK_SQL,
    RESET_LESSON_EPOCH_SQL,
    RESTARTED_SQL,
    applyQuizCheck,
    deleteAllLessonProgress,
    getLessonProgress,
    markLessonProgress,
    resetLessonProgress,
    saveLessonProgress,
} from '../../tools/core/lessonProgress.js';
import {
    BLENDER_XP_SQL, LEARNING_DAY_SQL, LESSON_XP_SQL, XP_LOCK_SQL, getAchievements, noteBlenderProgress, noteLearning,
} from '../../tools/core/achievements.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(ROOT, 'server', 'migrations');
const ROLE_SQL = path.join(ROOT, 'deploy', 'risepath-vm', 'sql', 'mcp_remote_role.sql');
const ROLE = 'risepath_mcp_remote';
const TABLES = ['lesson_progress_lesson_resets', 'xp_awards', 'learning_days'];
const COURSE = 'vibe-coding';
const LESSON = 'vibe-ch1';
const HOLD_MS = 2000;
const LEAD_MS = 600;
/** A waiter counts as blocked when it waited at least this long. */
const BLOCKED_MS = HOLD_MS - LEAD_MS - 400;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @param {string} sql */
const norm = (sql) => sql.replace(/\s+/g, ' ').trim().toLowerCase();
let counter = 0;
/** A fresh UUID per test learner (tag and counter in hex). @param {string} tag */
const uid = (tag) => {
    counter += 1;
    const n = counter.toString(16).padStart(4, '0');
    const hex = (Buffer.from(tag).toString('hex') + n).padEnd(12, '0').slice(-12);
    return `abcd${n}-0000-4000-8000-${hex}`;
};
/** Runs fn with console.error and console.warn silenced (an expected refusal logs). @template T @param {() => Promise<T>} fn */
const quietly = async (fn) => {
    const { error, warn } = console;
    console.error = () => {};
    console.warn = () => {};
    try {
        return await fn();
    } finally {
        console.error = error;
        console.warn = warn;
    }
};

/** @type {{ id: string, ok: boolean }[]} */
const results = [];
/** @param {string} id @param {boolean} ok @param {string} label */
function check(id, ok, label) {
    results.push({ id, ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(4)} ${label}`);
}
/** @type {string[]} */
const skipped = [];
/** @param {string} id @param {string} label */
function skip(id, label) {
    skipped.push(id);
    console.log(`skip ${id.padEnd(4)} ${label}`);
}

/** @param {pg.Pool} pool @param {string} sql @param {unknown[]} [params] */
const count = async (pool, sql, params = []) => Number((await pool.query(sql, params)).rows[0]?.n ?? NaN);
/** The SQLSTATE a statement fails with, or 'none'. @param {Promise<unknown>} promise */
const codeOf = (promise) => promise.then(() => 'none', (/** @type {any} */ e) => String(e?.code ?? e?.message));

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

/**
 * The pool the tools/core functions get (setPoolForTests): it records each failed statement's
 * SQLSTATE, can answer a statement without sending it (a control without a guard), and can hold a
 * connection right before a statement until released.
 * @param {pg.Pool} pool
 */
function instrument(pool) {
    const state = {
        /** @type {string[]} */
        errors: [],
        /** @type {((text: string) => boolean) | null} */
        skip: null,
        /** @type {{ when: (text: string) => boolean, reached: () => void, release: Promise<void> } | null} */
        hold: null,
    };
    /** @param {{ query: Function, release?: Function }} target */
    const wrap = (target) => ({
        /** @param {string} sql @param {unknown[]} [params] */
        query: async (sql, params) => {
            const text = norm(sql);
            if (state.skip?.(text)) return { rows: [], rowCount: 0 };
            const hold = state.hold;
            if (hold?.when(text)) {
                state.hold = null;
                hold.reached();
                await hold.release;
            }
            try {
                return await target.query(sql, params);
            } catch (error) {
                state.errors.push(String(/** @type {any} */ (error)?.code ?? 'error'));
                throw error;
            }
        },
        /** @param {unknown} [error] */
        release: (error) => target.release?.(error),
    });
    const facade = { query: (/** @type {string} */ sql, /** @type {unknown[]} */ params) => wrap(pool).query(sql, params), connect: async () => wrap(await pool.connect()) };
    /** Holds the next connection that sends a matching statement. @param {(text: string) => boolean} when */
    const holdBefore = (when) => {
        /** @type {() => void} */
        let reached = () => {};
        /** @type {() => void} */
        let release = () => {};
        const reachedP = new Promise((resolve) => { reached = () => resolve(undefined); });
        const releaseP = new Promise((resolve) => { release = () => resolve(undefined); });
        state.hold = { when, reached, release: /** @type {Promise<void>} */ (releaseP) };
        return { reached: reachedP, release };
    };
    setPoolForTests(/** @type {any} */ (facade));
    return { state, holdBefore };
}

const answered = { 'check-quiz/q4': { attempts: 1, correct: true, chosen: ['x'], firstTry: true } };
/** @param {Record<string, unknown>} [overrides] */
const record = (overrides = {}) => ({ v: 1, seen: ['hook-b1'], answers: answered, checks: {}, lastBlockId: null, updatedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });

/**
 * A learner with a stub and, unless `progress` is false, a started vibe-ch1 record saved through
 * saveLessonProgress (the REST path, on the current pool override).
 * @param {pg.Pool} pool @param {string} tag @param {{ progress?: boolean }} [options]
 */
async function learner(pool, tag, { progress = true } = {}) {
    const id = uid(tag);
    await pool.query('INSERT INTO auth.users (id) VALUES ($1)', [id]);
    if (progress) {
        const saved = await saveLessonProgress({ userId: id, epoch: null, records: [{ courseSlug: COURSE, lessonId: LESSON, progress: record() }] });
        if ('error_type' in saved || saved.records.length !== 1) throw new Error(`seed save failed: ${JSON.stringify(saved)}`);
    }
    return id;
}

/** @param {pg.Pool} pool */
async function p1(pool) {
    const { rows } = await pool.query(`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS ref, c.confdeltype AS action
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1) ORDER BY 1`, [TABLES]);
    const got = rows.map((r) => `${r.tbl}.${r.col}->${r.ref}:${r.action}`).join(' ');
    check('P1', got === 'learning_days.user_id->auth.users:c lesson_progress_lesson_resets.user_id->auth.users:c xp_awards.user_id->auth.users:c',
        `the three tables' only FKs are user_id → auth.users ON DELETE CASCADE, once each after two runs: ${got}`);
    const grants = await count(pool, `SELECT count(*) AS n FROM information_schema.role_table_grants WHERE table_name = ANY($1) AND grantee <> current_user`, [TABLES]);
    check('P1', grants === 0, `no grant on the three tables to any other role (${grants})`);
}

/** @param {pg.Pool} pool */
async function p2(pool) {
    const id = uid('p2');
    await pool.query('INSERT INTO auth.users (id) VALUES ($1)', [id]);
    const award = 'INSERT INTO xp_awards (user_id, source, item_key, milestone, xp) VALUES ($1, $2, $3, $4, $5)';
    const cases = [
        ['lesson start 40', [id, 'lesson', 'c/l', 'start', 40]],
        ['lesson done 10', [id, 'lesson', 'c/l', 'done', 10]],
        ['blender start 80', [id, 'blender_stage', 'blender/1', 'start', 80]],
        ['blender done 40', [id, 'blender_stage', 'blender/1', 'done', 40]],
        ['milestone finish', [id, 'lesson', 'c/l', 'finish', 40]],
        ['source diagnosis', [id, 'diagnosis', 'c/l', 'done', 40]],
        ['item key without a slash', [id, 'lesson', 'cl', 'start', 10]],
        ['item key upper case', [id, 'lesson', 'C/l', 'start', 10]],
    ];
    const codes = [];
    for (const [label, params] of cases) codes.push(`${label}:${await codeOf(pool.query(award, /** @type {unknown[]} */ (params)))}`);
    codes.push(`lesson id:${await codeOf(pool.query("INSERT INTO lesson_progress_lesson_resets (user_id, course_slug, lesson_id) VALUES ($1, 'c', 'L.1')", [id]))}`);
    const bad = codes.filter((c) => !c.endsWith(':23514'));
    check('P2', bad.length === 0, bad.length ? `accepted or failed otherwise: ${bad.join(', ')}` : `${codes.length} wrong rows refused 23514 (amounts, milestone, source, item key, lesson id)`);
    const ok = await codeOf(pool.query(`${award}, ($1, 'lesson', 'c/l', 'done', 40), ($1, 'blender_stage', 'blender/4', 'done', 80)`, [id, 'lesson', 'c/l', 'start', 10]));
    const dup = await codeOf(pool.query(award, [id, 'lesson', 'c/l', 'start', 10]));
    check('P2', ok === 'none' && dup === '23505', `the three right amounts insert (${ok}); the same award twice is a primary-key conflict (${dup})`);
}

/** @param {pg.Pool} pool */
async function p3(pool) {
    const inst = instrument(pool);
    const id = await learner(pool, 'p3');
    const hold = inst.holdBefore((text) => text === 'commit');
    const resetP = resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
    await hold.reached;
    const t0 = Date.now();
    const saveP = saveLessonProgress({ userId: id, epoch: null, records: [{ courseSlug: COURSE, lessonId: LESSON, progress: record({ seen: ['hook-b1', 's1-b1'] }) }] })
        .then((r) => ({ r, waited: Date.now() - t0 }));
    const quizP = applyQuizCheck({ userId: id, courseSlug: COURSE, lessonId: LESSON, questionId: 'q1', choices: ['1'] })
        .then((r) => ({ r, waited: Date.now() - t0 }));
    await sleep(HOLD_MS);
    hold.release();
    const reset = await resetP;
    const save = await saveP;
    const quiz = await quizP;
    const row = (await pool.query('SELECT progress, state FROM lesson_progress WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3', [id, COURSE, LESSON])).rows[0];
    const gen = (await pool.query('SELECT lesson_epoch FROM lesson_progress_lesson_resets WHERE user_id = $1', [id])).rows[0];
    check('P3', !('error_type' in reset) && String(gen?.lesson_epoch) === reset.lessonEpoch, `the reset committed with lesson_epoch ${String(gen?.lesson_epoch).slice(0, 8)}…`);
    const rejected = 'rejected' in save.r ? save.r.rejected : [];
    check('P3', save.waited >= BLOCKED_MS && 'records' in save.r && save.r.records.length === 0
        && rejected.length === 1 && rejected[0].error_type === 'lesson_reset' && rejected[0].lessonEpoch === /** @type {any} */ (reset).lessonEpoch,
        `a save of the old generation started during the reset waited ${save.waited} ms on the learner lock, then was refused ${rejected[0]?.error_type} with the new generation`);
    const answers = Object.keys(row?.progress?.answers ?? {});
    check('P3', !('error_type' in quiz.r) && quiz.waited >= BLOCKED_MS && answers.join() === 's1-check/q1' && (row?.progress?.seen ?? []).length === 0,
        `an MCP answer started during it waited ${quiz.waited} ms on the row, then built on the empty record: answers [${answers.join(', ')}], seen ${(row?.progress?.seen ?? []).length}`);
}

/** @param {pg.Pool} pool @param {string} url */
async function p4(pool, url) {
    const psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
    if (psql.status !== 0) {
        skip('P4', 'psql is not on PATH: the role SQL cannot run here');
        return false;
    }
    const password = crypto.randomBytes(16).toString('hex');
    const run = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `mcp_password=${password}`, '-d', url, '-f', ROLE_SQL], { encoding: 'utf8' });
    check('P4', run.status === 0, `deploy/risepath-vm/sql/mcp_remote_role.sql through ${psql.stdout.trim()}: exit ${run.status}${run.status ? ` ${run.stderr.trim().split('\n').slice(-2).join(' ')}` : ''}`);
    if (run.status !== 0) return true;
    const privileges = [];
    for (const table of [...TABLES, 'lesson_progress_resets']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
            if ((await pool.query('SELECT has_table_privilege($1, $2, $3) AS p', [ROLE, table, privilege])).rows[0].p) privileges.push(`${privilege} ${table}`);
        }
    }
    const progress = (await pool.query("SELECT has_table_privilege($1, 'lesson_progress', 'INSERT') AS p", [ROLE])).rows[0].p;
    check('P4', privileges.length === 0 && progress === true, `the role has no privilege on the reset, XP and day tables (${privileges.join(', ') || 'none'}), and its lesson_progress grant is in place (${progress})`);

    // A restarted lesson, set up by the app's own role.
    instrument(pool);
    const id = await learner(pool, 'p4');
    const reset = await resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
    const rolePool = new pg.Pool({ connectionString: url, max: 2, options: `-c role=${ROLE}` });
    try {
        const whoami = (await rolePool.query('SELECT current_user AS u')).rows[0].u;
        instrument(rolePool);
        const quiz = await applyQuizCheck({ userId: id, courseSlug: COURSE, lessonId: LESSON, questionId: 'q1', choices: ['1'] });
        const mark = await markLessonProgress({ userId: id, courseSlug: COURSE, lessonId: LESSON, lastBlockId: 's1-b1' });
        const read = await getLessonProgress({ userId: id, courseSlug: COURSE, lessonId: LESSON });
        const errors = [quiz, mark, read].map((r) => /** @type {any} */ (r).error_type).filter(Boolean);
        const stored = 'records' in read ? read.records[0] : null;
        check('P4', whoami === ROLE && !('error_type' in reset) && errors.length === 0 && Object.keys(stored?.progress.answers ?? {}).join() === 's1-check/q1',
            `as ${whoami}: course-quiz-check, course-progress-update and course-progress-get work on a restarted lesson (errors: ${errors.join(', ') || 'none'}; answers ${Object.keys(stored?.progress.answers ?? {}).join(', ')})`);
        const rest = await quietly(() => getLessonProgress({ userId: id, withEpoch: true }));
        const star = await codeOf(rolePool.query('SELECT * FROM xp_awards'));
        check('P4', /** @type {any} */ (rest).error_type === 'permission_denied' && star === '42501',
            `control: the REST read with the generations is refused to the role (${/** @type {any} */ (rest).error_type}); SELECT * FROM xp_awards → ${star}`);
    } finally {
        await rolePool.end();
    }
    return true;
}

/** @param {pg.Pool} pool */
async function p5(pool) {
    instrument(pool);
    const id = await learner(pool, 'p5');
    await pool.query("INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, state, progress_updated_at) VALUES ($1, 'claude-code', 'cc-04-verify', '{}', 'read', now())", [id]);
    await pool.query("INSERT INTO user_progress (user_id, course_id, completed_stages) VALUES ($1, 'blender', ARRAY['2', '1', '9'])", [id]);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
        await c1.query('BEGIN');
        await c2.query('BEGIN');
        await c1.query(XP_LOCK_SQL, [id]);
        const first = (await c1.query(LESSON_XP_SQL, [id])).rowCount + (await c1.query(BLENDER_XP_SQL, [id])).rowCount;
        const t0 = Date.now();
        const second = c2.query(XP_LOCK_SQL, [id])
            .then(async () => ({ waited: Date.now() - t0, n: (await c2.query(LESSON_XP_SQL, [id])).rowCount + (await c2.query(BLENDER_XP_SQL, [id])).rowCount }));
        await sleep(HOLD_MS - LEAD_MS);
        await c1.query('COMMIT');
        const { waited, n } = await second;
        await c2.query('COMMIT');
        const rows = (await pool.query("SELECT source || ' ' || item_key || ' ' || milestone || ' ' || xp AS a FROM xp_awards WHERE user_id = $1 ORDER BY 1", [id])).rows.map((r) => r.a);
        check('P5', first === 5 && n === 0 && waited >= BLOCKED_MS && rows.length === 5,
            `two reconciles of one learner: the first inserted ${first}, the second waited ${waited} ms on the XP lock and inserted ${n}; ${rows.length} rows (${rows.join('; ')})`);
    } catch (error) {
        check('P5', false, `concurrent reconciles failed: ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`);
        await c1.query('ROLLBACK').catch(() => {});
        await c2.query('ROLLBACK').catch(() => {});
    } finally {
        c1.release();
        c2.release();
    }

    // A reset holding everything (learner lock, stub, row, XP lock) while a reconcile waits; then
    // a reconcile holding the XP lock while a reset waits for it. No deadlock either way.
    for (const order of ['reset first', 'reconcile first']) {
        const inst = instrument(pool);
        const user = await learner(pool, 'p5r');
        const c = await pool.connect();
        try {
            /** @type {Promise<any>} */
            let resetP;
            /** @type {Promise<number>} */
            let reconcileP;
            if (order === 'reset first') {
                const hold = inst.holdBefore((text) => text === 'commit');
                resetP = resetLessonProgress({ userId: user, epoch: null, courseSlug: COURSE, lessonId: LESSON });
                await hold.reached;
                await c.query('BEGIN');
                const t0 = Date.now();
                reconcileP = c.query(XP_LOCK_SQL, [user]).then(async () => {
                    await c.query(LESSON_XP_SQL, [user]);
                    await c.query(BLENDER_XP_SQL, [user]);
                    await c.query('COMMIT');
                    return Date.now() - t0;
                });
                await sleep(LEAD_MS);
                hold.release();
            } else {
                await c.query('BEGIN');
                await c.query(XP_LOCK_SQL, [user]);
                const t0 = Date.now();
                resetP = resetLessonProgress({ userId: user, epoch: null, courseSlug: COURSE, lessonId: LESSON });
                await sleep(LEAD_MS);
                await c.query(LESSON_XP_SQL, [user]);
                await c.query(BLENDER_XP_SQL, [user]);
                await c.query('COMMIT');
                reconcileP = Promise.resolve(Date.now() - t0);
            }
            const reset = await resetP;
            const waited = await reconcileP;
            const n = await count(pool, 'SELECT count(*) AS n FROM xp_awards WHERE user_id = $1', [user]);
            check('P5', !('error_type' in reset) && !inst.state.errors.includes('40P01') && n === 1,
                `${order}: the reset (${reset.error_type ?? 'ok'}) and a reconcile (${waited} ms) both finished, no deadlock; ${n} award`);
        } catch (error) {
            await c.query('ROLLBACK').catch(() => {});
            check('P5', false, `${order}: ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`);
        } finally {
            c.release();
        }
    }
}

/**
 * Stage 2: the achievements read against a reset that holds the XP lock, then everything at once;
 * then the XP lock's key against the case of the id.
 * @param {pg.Pool} pool
 */
async function p5Read(pool) {
    {
        const inst = instrument(pool);
        const user = await learner(pool, 'p5a');
        const hold = inst.holdBefore((text) => text === 'commit');
        const resetP = resetLessonProgress({ userId: user, epoch: null, courseSlug: COURSE, lessonId: LESSON });
        await hold.reached;
        const t0 = Date.now();
        const readP = getAchievements({ userId: user }).then((r) => ({ r, waited: Date.now() - t0 }));
        await sleep(HOLD_MS - LEAD_MS);
        hold.release();
        const reset = await resetP;
        const { r: read, waited } = await readP;
        const ok = !('error_type' in reset) && !('error_type' in read) && !inst.state.errors.includes('40P01');
        check('P5', ok && waited >= BLOCKED_MS && /** @type {any} */ (read).xp.total === 10 && /** @type {any} */ (read).counts.lessonsStarted === 1,
            `the achievements read waited ${waited} ms for a reset holding the XP lock, then counted what the reset kept: ${/** @type {any} */ (read).xp?.total ?? /** @type {any} */ (read).error_type} XP (start 10 of the restarted lesson)`);
    }
    const rounds = 4;
    const bad = [];
    for (let round = 0; round < rounds; round += 1) {
        const inst = instrument(pool);
        const user = await learner(pool, `p5g${round}`);
        await pool.query("INSERT INTO user_progress (user_id, course_id, completed_stages) VALUES ($1, 'blender', ARRAY['1', '2'])", [user]);
        const [a, b, lesson, stage, reset, c] = await Promise.all([
            getAchievements({ userId: user }),
            getAchievements({ userId: user }),
            noteLearning({ userId: user }),
            noteBlenderProgress({ userId: user }),
            resetLessonProgress({ userId: user, epoch: null, courseSlug: COURSE, lessonId: LESSON }),
            getAchievements({ userId: user }),
        ]);
        const after = await getAchievements({ userId: user });
        const awards = (await pool.query("SELECT source || ' ' || item_key || ' ' || milestone AS a FROM xp_awards WHERE user_id = $1 ORDER BY 1", [user])).rows.map((r) => r.a);
        const days = await count(pool, 'SELECT count(*) AS n FROM learning_days WHERE user_id = $1', [user]);
        const reads = [a, b, c, after];
        const fine = reads.every((r) => !('error_type' in r)) && lesson === true && stage === true && !('error_type' in reset)
            && !inst.state.errors.includes('40P01') && inst.state.errors.length === 0
            && awards.join('|') === 'blender_stage blender/1 done|blender_stage blender/2 done|lesson vibe-coding/vibe-ch1 start'
            && /** @type {any} */ (after).xp.total === 170 && days === 1
            && reads.every((r) => [10, 160, 170].includes(/** @type {any} */ (r).xp?.total));
        if (!fine) bad.push(`round ${round}: reads ${reads.map((r) => /** @type {any} */ (r).xp?.total ?? /** @type {any} */ (r).error_type).join('/')}, hooks ${lesson}/${stage}, reset ${/** @type {any} */ (reset).error_type ?? 'ok'}, errors [${inst.state.errors.join(',')}], awards ${awards.join('; ')}, days ${days}`);
    }
    check('P5', bad.length === 0, bad.length ? bad.join(' || ') : `${rounds} rounds of three achievements reads, noteLearning, noteBlenderProgress and a reset of one learner at once: no deadlock or error, each award once (170 XP), one learning day`);
    // The lock key is the canonical uuid text: a transaction holding the XP lock under the lower-case
    // id (a read or a hook) makes a reset sent with the upper-case id wait. It holds nothing else.
    {
        const inst = instrument(pool);
        const user = await learner(pool, 'p5c');
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            await c.query(XP_LOCK_SQL, [user]);
            const t0 = Date.now();
            const resetP = resetLessonProgress({ userId: user.toUpperCase(), epoch: null, courseSlug: COURSE, lessonId: LESSON })
                .then((r) => ({ r, waited: Date.now() - t0 }));
            await sleep(HOLD_MS - LEAD_MS);
            await c.query('COMMIT');
            const { r, waited } = await resetP;
            const n = await count(pool, 'SELECT count(*) AS n FROM xp_awards WHERE user_id = $1', [user]);
            check('P5', !('error_type' in r) && waited >= BLOCKED_MS && inst.state.errors.length === 0 && n === 1,
                `one XP lock per learner whatever the id's case: a reset sent with the upper-case id waited ${waited} ms for a transaction holding the lock under the lower-case id (${/** @type {any} */ (r).error_type ?? 'ok'}; ${n} award)`);
        } catch (error) {
            await c.query('ROLLBACK').catch(() => {});
            check('P5', false, `XP lock and the id's case: ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`);
        } finally {
            c.release();
        }
    }
}

/** @param {pg.Pool} pool */
async function p6(pool) {
    instrument(pool);
    const id = await learner(pool, 'p6');
    const reset = await resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
    if ('error_type' in reset) throw new Error(`P6 reset: ${reset.error_type}`);
    await saveLessonProgress({ userId: id, epoch: null, records: [{ courseSlug: COURSE, lessonId: LESSON, lessonEpoch: reset.lessonEpoch, progress: record({ answers: {} }) }] });
    await pool.query(LEARNING_DAY_SQL, [id]);
    const deleted = await deleteAllLessonProgress({ userId: id });
    if ('error_type' in deleted) throw new Error(`P6 delete: ${deleted.error_type}`);
    const n = async (/** @type {string} */ table) => count(pool, `SELECT count(*) AS n FROM ${table} WHERE user_id = $1`, [id]);
    const kept = { progress: await n('lesson_progress'), resets: await n('lesson_progress_lesson_resets'), awards: await n('xp_awards'), days: await n('learning_days') };
    const gen = (await pool.query('SELECT lesson_epoch FROM lesson_progress_lesson_resets WHERE user_id = $1', [id])).rows[0];
    check('P6', deleted.deleted === 1 && kept.progress === 0 && kept.resets === 1 && String(gen?.lesson_epoch) === reset.lessonEpoch && kept.awards === 1 && kept.days === 1,
        `delete-all removed ${deleted.deleted} row and kept the generation, the award and the day (${JSON.stringify(kept)})`);
    const old = await saveLessonProgress({ userId: id, epoch: deleted.epoch, records: [{ courseSlug: COURSE, lessonId: LESSON, progress: record() }] });
    const fresh = await saveLessonProgress({ userId: id, epoch: deleted.epoch, records: [{ courseSlug: COURSE, lessonId: LESSON, lessonEpoch: reset.lessonEpoch, progress: record({ answers: {}, seen: ['s1-b1'] }) }] });
    const refusal = 'rejected' in old ? old.rejected[0] : undefined;
    check('P6', refusal?.error_type === 'lesson_reset' && refusal.lessonResetAt === reset.lessonResetAt && !('record' in refusal)
        && 'records' in fresh && fresh.records.length === 1 && fresh.records[0].lessonEpoch === reset.lessonEpoch,
        `afterwards a record without the generation is refused (${refusal?.error_type}, lessonResetAt kept, no record) and the kept generation saves (${'records' in fresh ? fresh.records.length : fresh.error_type})`);

    // An AI app's write (course-progress-update: the row lock only, never the learner lock) holds
    // the started lesson's row and marks it read; delete-all starts, waits for the row, and the
    // write commits. The shipped delete awards from the rows its DELETE returns: start and done.
    // Control: the order before (reconcile, then a plain DELETE) read the row before the write.
    for (const variant of ['delete-all', 'control']) {
        instrument(pool);
        const user = await learner(pool, variant === 'control' ? 'p6c' : 'p6m');
        const mcp = await pool.connect();
        try {
            await mcp.query('BEGIN');
            await mcp.query("UPDATE lesson_progress SET state = 'read' WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3", [user, COURSE, LESSON]);
            const t0 = Date.now();
            let waited = 0;
            const deleteP = (variant === 'control' ? deleteAllBefore(pool, user) : deleteAllLessonProgress({ userId: user }))
                .then((result) => { waited = Date.now() - t0; return result; });
            await sleep(HOLD_MS - LEAD_MS);
            await mcp.query('COMMIT');
            const result = await deleteP;
            const awards = (await pool.query('SELECT milestone FROM xp_awards WHERE user_id = $1 ORDER BY milestone', [user])).rows.map((r) => r.milestone).join(',');
            const left = await count(pool, 'SELECT count(*) AS n FROM lesson_progress WHERE user_id = $1', [user]);
            if (variant === 'delete-all') {
                check('P6', !('error_type' in result) && result.deleted === 1 && left === 0 && awards === 'done,start' && waited >= BLOCKED_MS,
                    `an AI app's write committed while delete-all waited ${waited} ms for the row: deleted ${/** @type {any} */ (result).deleted ?? /** @type {any} */ (result).error_type}, awards ${awards} (the row as written)`);
            } else {
                check('P6', awards === 'start' && left === 0 && waited >= BLOCKED_MS,
                    `control (reconcile, then a plain DELETE): the DELETE waited ${waited} ms and removed the row the write marked read; awards ${awards || 'none'} (done lost, the guard is needed)`);
            }
        } catch (error) {
            await mcp.query('ROLLBACK').catch(() => {});
            check('P6', false, `${variant} racing an AI app's write: ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`);
        } finally {
            mcp.release();
        }
    }
}

/**
 * P6's control: delete-all's statements as they were before the awards moved into the DELETE
 * (the reconcile reads lesson_progress without row locks, then a plain DELETE).
 * @param {pg.Pool} pool @param {string} userId
 */
async function deleteAllBefore(pool, userId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(LEARNER_LOCK_SQL, [userId]);
        await client.query(ACCOUNT_STUB_SHARE_SQL, [userId]);
        await client.query(XP_LOCK_SQL, [userId]);
        await client.query(LESSON_XP_SQL, [userId]);
        const deleted = await client.query('DELETE FROM lesson_progress WHERE user_id = $1', [userId]);
        await client.query('COMMIT');
        return { deleted: deleted.rowCount ?? 0 };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

/** @param {pg.Pool} pool */
async function p7(pool) {
    const inst = instrument(pool);
    const id = await learner(pool, 'p7');
    await resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
    await pool.query(LEARNING_DAY_SQL, [id]);
    const before = await Promise.all(TABLES.map((t) => count(pool, `SELECT count(*) AS n FROM ${t} WHERE user_id = $1`, [id])));
    await pool.query('DELETE FROM auth.users WHERE id = $1', [id]);
    const after = await Promise.all(TABLES.map((t) => count(pool, `SELECT count(*) AS n FROM ${t} WHERE user_id = $1`, [id])));
    check('P7', before.every((x) => x === 1) && after.every((x) => x === 0), `the stub delete cascades: ${TABLES.map((t, i) => `${t} ${before[i]}→${after[i]}`).join(', ')}`);
    const codes = [
        await codeOf(pool.query(RESET_LESSON_EPOCH_SQL, [id, COURSE, LESSON])),
        await codeOf(pool.query("INSERT INTO xp_awards (user_id, source, item_key, milestone, xp) VALUES ($1, 'lesson', 'c/l', 'start', 10)", [id])),
        await codeOf(pool.query(LEARNING_DAY_SQL, [id])),
    ];
    check('P7', codes.every((c) => c === '23503'), `inserts for the deleted account fail their foreign key: ${codes.join(', ')}`);
    // A save answered just before the deletion: its after-save hooks run on a deleted account.
    // noteLearning's day fails its foreign key (logged, false); noteBlenderProgress finds no
    // user_progress row (it cascaded too) and writes nothing.
    const errorsBefore = inst.state.errors.length;
    const notes = await quietly(async () => [await noteLearning({ userId: id }), await noteBlenderProgress({ userId: id })]);
    const left = await Promise.all(TABLES.map((t) => count(pool, `SELECT count(*) AS n FROM ${t} WHERE user_id = $1`, [id])));
    const hookErrors = inst.state.errors.slice(errorsBefore);
    check('P7', notes[0] === false && hookErrors.join() === '23503' && left.every((x) => x === 0),
        `after the deletion the after-save hooks never throw: noteLearning ${notes[0]} (${hookErrors.join(', ') || 'no error'}, logged), noteBlenderProgress ${notes[1]}; nothing written (${left.join(', ')})`);
}

/** @param {pg.Pool} pool */
async function p8(pool) {
    const id = uid('p8');
    await pool.query('INSERT INTO auth.users (id) VALUES ($1)', [id]);
    const lp = "INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, state, progress_updated_at) VALUES ($1, 'vibe-coding', $2, '{}', $3, $4)";
    await pool.query(lp, [id, 'a', 'in_progress', '2026-10-20T10:00:00Z']);
    await pool.query(lp, [id, 'b', 'read', '2030-01-01T00:00:00Z']); // a clock ahead: the day is the row's write
    await pool.query(lp, [id, 'c', 'not_started', '2026-10-21T00:00:00Z']);
    await pool.query(lp, [id, 'd', 'mastered', '1970-01-01T00:00:00Z']); // awards, but no day from the 1970 clock
    await pool.query("INSERT INTO user_progress (user_id, course_id, completed_stages) VALUES ($1, 'blender', ARRAY['1', '3', '9', '1']), ($1, 'blender2', ARRAY['2'])", [id]);
    const ev = 'INSERT INTO learning_events (user_id, type, created_at) VALUES ($1, $2, $3)';
    await pool.query(ev, [id, 'lesson_start', '2026-10-24T14:59:59Z']);
    await pool.query(ev, [id, 'stage_complete', '2026-10-24T15:00:00Z']);
    await pool.query(ev, [id, 'diagnosis_complete', '2026-10-01T00:00:00Z']);
    await pool.query(ev, [id, 'course_generated', '2026-10-02T00:00:00Z']);
    await pool.query(ev, [id, 'course_complete', '2026-10-03T00:00:00Z']);
    await applyMigration(pool, '019_phase5_learning.sql');
    const awards = async () => (await pool.query("SELECT source || ' ' || item_key || ' ' || milestone || ' ' || xp AS a FROM xp_awards WHERE user_id = $1 ORDER BY 1", [id])).rows.map((r) => r.a);
    const days = async () => (await pool.query("SELECT to_char(day, 'YYYY-MM-DD') AS d FROM learning_days WHERE user_id = $1 ORDER BY 1", [id])).rows.map((r) => r.d);
    const today = (await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
    const want = [
        'blender_stage blender/1 done 80', 'blender_stage blender/3 done 80',
        'lesson vibe-coding/a start 10', 'lesson vibe-coding/b done 40', 'lesson vibe-coding/b start 10',
        'lesson vibe-coding/d done 40', 'lesson vibe-coding/d start 10',
    ];
    const got = await awards();
    check('P8', got.join('|') === want.join('|'), `backfilled awards: ${got.join('; ')}`);
    const wantDays = [...new Set(['2026-10-20', '2026-10-24', '2026-10-25', today])].sort();
    const gotDays = await days();
    check('P8', gotDays.join() === wantDays.join(), `backfilled days (Japan time; 14:59:59Z → the 24th, 15:00:00Z → the 25th; a clock ahead → today ${today}; no diagnosis or generation day): ${gotDays.join(', ')}`);
    await applyMigration(pool, '019_phase5_learning.sql');
    check('P8', (await awards()).join('|') === got.join('|') && (await days()).join() === gotDays.join(), 'a re-run of 019 adds nothing');
    // Stage 2: the achievements read shows the backfill as it is, and adds nothing.
    instrument(pool);
    const read = /** @type {any} */ (await getAchievements({ userId: id.toUpperCase() }));
    const firstCourse = read.badges?.find((/** @type {any} */ b) => b.id === 'first_course');
    const fiveLessons = read.badges?.find((/** @type {any} */ b) => b.id === 'five_lessons');
    check('P8', !read.error_type && read.learnerId === id
        && JSON.stringify(read.xp) === JSON.stringify({ total: 270, level: 3, intoLevel: 70, levelSize: 100, toNextLevel: 30 })
        && JSON.stringify(read.counts) === JSON.stringify({ lessonsStarted: 3, lessonsDone: 2, stagesDone: 2 })
        && read.streak?.today === today && read.streak?.timeZone === 'Asia/Tokyo' && read.streak?.activeToday === true && read.streak?.best >= 2
        && fiveLessons?.current === 4 && fiveLessons?.earned === false
        && firstCourse?.course === 'blender' && firstCourse?.current === 2 && firstCourse?.goal === 4,
        `the achievements read of the backfilled learner: ${read.xp?.total ?? read.error_type} XP, level ${read.xp?.level}, counts ${JSON.stringify(read.counts)}, today ${read.streak?.today} (server, Japan time), best ${read.streak?.best}, five_lessons ${fiveLessons?.current}/5, first_course ${firstCourse?.course} ${firstCourse?.current}/${firstCourse?.goal}`);
    check('P8', (await awards()).join('|') === got.join('|') && (await days()).join() === gotDays.join(), 'the read added no award and no day (the backfill already held them)');
}

/** @param {pg.Pool} pool */
async function p9(pool) {
    const id = uid('p9');
    await pool.query('INSERT INTO auth.users (id) VALUES ($1)', [id]);
    const PLACEHOLDER = JSON.stringify({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: new Date(0).toISOString() });
    // tools/core/lessonProgress.js before Phase 5 (the image that keeps serving while 019 is applied).
    const OLD = [
        ["SELECT pg_advisory_xact_lock(hashtext('lesson_progress:' || $1))", [id]],
        ['SELECT epoch FROM lesson_progress_resets WHERE user_id = $1', [id]],
        [`INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, progress_updated_at)
             VALUES ($1, $2, $3, $4::jsonb, to_timestamp(0))
             ON CONFLICT (user_id, course_slug, lesson_id) DO NOTHING
             RETURNING true AS created`, [id, COURSE, LESSON, PLACEHOLDER]],
        [`SELECT progress FROM lesson_progress
              WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3
              FOR UPDATE`, [id, COURSE, LESSON]],
        [`UPDATE lesson_progress
            SET progress = $4::jsonb, pct = $5, state = $6, content_hash = $7, progress_updated_at = $8
          WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3`, [id, COURSE, LESSON, PLACEHOLDER, 5, 'in_progress', 'sha256:x', new Date().toISOString()]],
        [`SELECT course_slug, lesson_id, progress, pct, state, content_hash, progress_updated_at
               FROM lesson_progress
              WHERE user_id = $1
              ORDER BY course_slug, lesson_id`, [id]],
        [`SELECT course_slug, lesson_id, progress, pct, state, content_hash, progress_updated_at
               FROM lesson_progress
              WHERE user_id = $1 AND course_slug = $2
              ORDER BY course_slug, lesson_id`, [id, COURSE]],
        [`SELECT course_slug, lesson_id, progress, pct, state, content_hash, progress_updated_at
               FROM lesson_progress
              WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3
              ORDER BY course_slug, lesson_id`, [id, COURSE, LESSON]],
        [`UPDATE lesson_progress SET pct = $4, state = $5, content_hash = $6
                      WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3 AND content_hash IS DISTINCT FROM $6`, [id, COURSE, LESSON, 7, 'in_progress', 'sha256:y']],
        ['DELETE FROM lesson_progress WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3', [id, COURSE, LESSON]],
        ['DELETE FROM lesson_progress WHERE user_id = $1', [id]],
        [`INSERT INTO lesson_progress_resets (user_id) VALUES ($1)
             ON CONFLICT (user_id) DO UPDATE SET epoch = gen_random_uuid(), reset_at = now()
             RETURNING epoch`, [id]],
        [RESTARTED_SQL, [id]],
    ];
    const client = await pool.connect();
    const failed = [];
    try {
        await client.query('BEGIN');
        for (const [sql, params] of OLD) {
            await client.query('SAVEPOINT s');
            try {
                await client.query(/** @type {string} */ (sql), /** @type {unknown[]} */ (params));
                await client.query('RELEASE SAVEPOINT s');
            } catch (error) {
                failed.push(`${norm(/** @type {string} */ (sql)).slice(0, 40)}…: ${/** @type {any} */ (error).code}`);
                await client.query('ROLLBACK TO SAVEPOINT s');
            }
        }
        await client.query('COMMIT');
    } finally {
        client.release();
    }
    check('P9', failed.length === 0, failed.length ? `old statements failed: ${failed.join('; ')}` : `all ${OLD.length} statements of the previous api image run on the migrated schema`);
}

/** @param {pg.Pool} pool */
async function p10(pool) {
    // Order A: the reset holds the learner lock, the stub (KEY SHARE) and the row; the deletion's
    // FOR UPDATE on the stub waits; both finish.
    {
        const inst = instrument(pool);
        const id = await learner(pool, 'p10a');
        const hold = inst.holdBefore((text) => text === norm(XP_LOCK_SQL));
        const resetP = resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
        await hold.reached;
        const del = await pool.connect();
        let outcome = 'none';
        let waited = 0;
        try {
            await del.query('BEGIN');
            await del.query(DELETION_SQL.lock, [id]);
            const t0 = Date.now();
            const stubP = del.query(DELETION_SQL.lockStub, [id]).then(() => { waited = Date.now() - t0; });
            await sleep(HOLD_MS - LEAD_MS);
            hold.release();
            const reset = await resetP;
            await stubP;
            await del.query(DELETION_SQL.deleteStub, [id]);
            await del.query('COMMIT');
            outcome = 'error_type' in reset ? `reset ${reset.error_type}` : 'both';
        } catch (error) {
            outcome = `deletion ${/** @type {any} */ (error).code}`;
            await del.query('ROLLBACK').catch(() => {});
        } finally {
            del.release();
        }
        const left = await count(pool, 'SELECT (SELECT count(*) FROM auth.users WHERE id = $1) + (SELECT count(*) FROM lesson_progress WHERE user_id = $1) + (SELECT count(*) FROM xp_awards WHERE user_id = $1) AS n', [id]);
        check('P10', outcome === 'both' && waited >= BLOCKED_MS && left === 0 && !inst.state.errors.includes('40P01'),
            `reset first: the deletion's stub lock waited ${waited} ms for the reset, then the deletion completed (${outcome}; rows left ${left})`);
    }
    // Order B: the deletion holds the stub FOR UPDATE; the reset waits at its KEY SHARE and, after
    // the stub is gone, fails its first insert (23503); no deadlock.
    {
        const inst = instrument(pool);
        const id = await learner(pool, 'p10b');
        const del = await pool.connect();
        let reset;
        let waited = 0;
        try {
            await del.query('BEGIN');
            await del.query(DELETION_SQL.lock, [id]);
            await del.query(DELETION_SQL.lockStub, [id]);
            const t0 = Date.now();
            const resetP = resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON }).then((r) => { waited = Date.now() - t0; return r; });
            await sleep(HOLD_MS);
            await del.query(DELETION_SQL.deleteStub, [id]);
            await del.query('COMMIT');
            reset = await resetP;
        } catch (error) {
            await del.query('ROLLBACK').catch(() => {});
            reset = { error_type: `deletion ${/** @type {any} */ (error).code}` };
        } finally {
            del.release();
        }
        const stub = await count(pool, 'SELECT count(*) AS n FROM auth.users WHERE id = $1', [id]);
        check('P10', reset && 'error_type' in reset && inst.state.errors.includes('23503') && !inst.state.errors.includes('40P01') && stub === 0 && waited >= BLOCKED_MS,
            `deletion first: the reset waited ${waited} ms at the stub, then failed ${inst.state.errors.join(',')} (${/** @type {any} */ (reset)?.error_type}); the deletion completed (stub ${stub})`);
    }
    // Control: order A without ACCOUNT_STUB_SHARE_SQL. The reset holds the row; the deletion takes
    // the stub and waits on the row (cascade); the reset's next insert needs the stub: 40P01.
    {
        const inst = instrument(pool);
        const id = await learner(pool, 'p10c');
        const stubShare = norm(ACCOUNT_STUB_SHARE_SQL);
        inst.state.skip = (text) => text === stubShare;
        const hold = inst.holdBefore((text) => text === norm(XP_LOCK_SQL));
        const resetP = resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
        await hold.reached;
        const del = await pool.connect();
        let delCode = 'none';
        try {
            await del.query('BEGIN');
            await del.query(DELETION_SQL.lock, [id]);
            await del.query(DELETION_SQL.lockStub, [id]);
            const deleteP = del.query(DELETION_SQL.deleteStub, [id]).then(() => 'none', (/** @type {any} */ e) => String(e.code));
            await sleep(LEAD_MS);
            hold.release();
            const reset = await resetP;
            delCode = await deleteP;
            await del.query(delCode === 'none' ? 'COMMIT' : 'ROLLBACK');
            const deadlock = inst.state.errors.includes('40P01') || delCode === '40P01';
            check('P10', deadlock, `control without the stub KEY SHARE: ${deadlock ? 'deadlock 40P01' : 'no deadlock (unexpected)'} (reset ${/** @type {any} */ (reset).error_type ?? 'ok'} ${inst.state.errors.join(',')}; deletion ${delCode})`);
        } catch (error) {
            await del.query('ROLLBACK').catch(() => {});
            check('P10', false, `control failed to run: ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`);
        } finally {
            inst.state.skip = null;
            del.release();
        }
    }
}

export async function main(argv = process.argv.slice(2)) {
    const { url, allowSkip, help } = parseArgs(argv);
    if (help || !url) {
        console.log('Usage: node scripts/db/verify-phase5.mjs --url postgres://<user>@<host>:<port>/<empty throwaway database> [--allow-skip]');
        console.log('Exit: 0 all passed, 1 a check failed, 2 refused or usage, 3 a check was skipped (without --allow-skip).');
        return help ? 0 : 2;
    }
    const pool = new pg.Pool({ connectionString: url, max: 8, statement_timeout: 30_000 });
    let roleRan = false;
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
        console.log(`# verify-phase5: database ${target.db}, PostgreSQL ${target.version}`);
        const files = await migrationFiles();
        for (const run of [1, 2]) {
            for (const file of files) await applyMigration(pool, file);
            check('P1', true, `run ${run}: applied ${files.length} migrations (${files[0]} … ${files.at(-1)}), each in its own transaction`);
        }
        await p1(pool);
        await p2(pool);
        await p3(pool);
        roleRan = true;
        await p4(pool, url);
        await p5(pool);
        await p5Read(pool);
        await p6(pool);
        await p7(pool);
        await p8(pool);
        await p9(pool);
        await p10(pool);
    } catch (error) {
        check('ERR', false, /** @type {Error} */ (error).stack ?? String(error));
    } finally {
        resetPoolForTests();
        if (roleRan) {
            await pool.query(`DROP OWNED BY ${ROLE}`).catch(() => {});
            await pool.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
            const left = (await pool.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1', [ROLE]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
            check('P4', left === 0, `the role ${ROLE} was dropped again (${left} left)`);
        }
        await pool.end();
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`# ${results.length - failed.length} passed, ${failed.length} failed${skipped.length ? `, ${skipped.length} skipped (${skipped.join(', ')})` : ''}`);
    const code = exitCode({ failed: failed.length, skipped: skipped.length, allowSkip });
    if (code === 3) console.log('# exit 3: a skipped check is not a pass (install psql, or --allow-skip to accept the gap)');
    return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
}
