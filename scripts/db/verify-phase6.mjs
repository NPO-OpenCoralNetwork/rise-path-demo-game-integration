#!/usr/bin/env node
// @ts-check
/**
 * Proves migration 020 (Phase 6: the review queue) and the server code that uses it on a real,
 * THROWAWAY PostgreSQL (16, as the VM's pgvector/pgvector:0.8.7-pg16). CI has no Postgres, so npm
 * test pins the SQL text (server/tests/migration020.test.js) and runs the code on in-memory fakes
 * (server/tests/reviewQueueCore.test.js); this script runs the shipped migration, SQL constants and
 * tools/core functions on Postgres. It is the Phase 6 stage gate and the 確かめ方 of
 * server/migrations/README.md.
 *
 *   createdb -h 127.0.0.1 -p 55621 -U postgres verify_p6
 *   node scripts/db/verify-phase6.mjs --url postgres://postgres@127.0.0.1:55621/verify_p6
 *
 * Same refusals and exit codes as verify-account-deletion.mjs (whose parseArgs and exitCode it
 * uses): exit 2 unless the database has no table in public or auth, the role risepath_mcp_remote
 * does not exist in the cluster, and the user is a superuser; 1 when a check failed; 3 when a check
 * could not run here (P4 without psql) unless --allow-skip. P4 creates risepath_mcp_remote with
 * deploy/risepath-vm/sql/mcp_remote_role.sql (through psql, a random password) and drops it again.
 * The database keeps the test rows: drop it (or the whole cluster) afterwards.
 *
 * Checks (Phase 6 design §7.3):
 *   P1  000–019: the review queue, the web grade and both MCP review tools answer "not set up"
 *       (table_not_found / review_unavailable; the entry's missing progress_changed_at is 42703),
 *       then 020 against an account deletion: the deletion inside its DELETE and 020 only
 *       wait for each other in both orders (020 creates its tables before it alters lesson_progress);
 *       control: the other order (the ALTER first) deadlocks (40P01). Then 000–020 apply twice. FK
 *       shape: review_cards.user_id → auth.users CASCADE, review_log's card → review_cards CASCADE,
 *       nothing else; no grant. The trigger: an INSERT sets progress_changed_at to the write's time
 *       (clock_timestamp(), not the transaction's start); a write-back
 *       (pct, state, content_hash), a same-progress UPDATE and the same jsonb in another key order
 *       keep it; a progress change moves it (the write's time); a row from before 020 gets its old updated_at on its
 *       first non-progress update; a value written directly is ignored
 *   P2  the CHECKs refuse (23514) every row the design forbids; a second log row the same day 23505;
 *       a log row for a card not in the queue 23503
 *   P3  the entry (getReviewQueue) on real rows: finished (Good, + 2), 「もう一度」 mark (Again, + 1),
 *       「覚えた」 mark in an unfinished lesson, a tombstone, an unknown card id; the 15:00Z boundary;
 *       a re-run adds nothing. The learning day: a GET write-back and an unchanged REST save before
 *       the first review read leave it. A card added later (an extended catalog): no memory, due
 *       tomorrow, also after a later change a read saw (a new resume point; every card marked:
 *       checked_at), after a revisit no read saw (an unmarked sibling), and with a prior once marked;
 *       marks first, then the finish: priors for the rest. Until the first review, a 「もう一度」
 *       after the entry gives the Again prior dated that change (ON CONFLICT DO UPDATE), a re-read
 *       with no change writes nothing, a reviewed card keeps its memory. A write whose transaction
 *       began before a REST save and wrote after it (an MCP writer: one row lock, no learner lock)
 *       finishes the lesson after a read entered the save's mark: the rest still get priors (the
 *       write's time is later than the mark's)
 *   P4  as risepath_mcp_remote with the shipped role SQL: the column grants are exactly what the
 *       review tools need. course-review-due (reviewDueForAgent, with the entry), a card added
 *       later, a later 「もう一度」 mark (the entry's DO UPDATE and checked_at UPDATE as the role, never
 *       reading prior_rating), course-review-grade reveal and rating (reviewGradeForAgent), a second
 *       rating (not_due), a mark on a reviewed card (kept) work; refused (42501): DELETE, SELECT *
 *       and SELECT entered_at / prior_rating / last_rating on review_cards (the entry and the grade
 *       only write the last two), INSERT or UPDATE of entered_at, any read of review_log, INSERT of review_day,
 *       learning_days, the lesson generations, the XP ledger; the role's UPDATE of
 *       lesson_progress.progress_changed_at is ignored (the trigger); an MCP review writes no
 *       learning day. Without the review grants both tools answer review_unavailable; re-running
 *       the role SQL brings them back
 *   P5  two grades of one card at once (web and MCP, both orders): one recorded, one not_due, one
 *       log row; two cards at 9 done: one review_limit; a grade waits for a REST save holding the
 *       learner lock
 *   P6  the entry against a one-lesson reset, both orders (and the reset given an upper-case id):
 *       no card of the reset lesson remains; control: the entry without LEARNER_LOCK_SQL brings them
 *       back. An entry that began before a
 *       delete-all and ran after it stamps entered_at after reset_at (clock_timestamp())
 *   P7  the reset deletes that lesson's cards and their log; delete-all deletes all; XP, learning
 *       days and lesson generations unchanged
 *   P8  account deletion (server/services/accountDeletion.js lock, lockStub, deleteStub) against a
 *       grade holding its card row and against an entry, both orders: no 40P01, both tables empty
 *       after; control: a log table with a second FK to auth.users deadlocks (40P01)
 *   P9  noteReviewDay writes the day it is given (the grade's summary.today, the log row's
 *       review_day): today, and yesterday as given (a grade just before 00:00 JST whose hook runs
 *       after it); after the account is deleted it returns false (23503) and never throws; an MCP
 *       grade writes no learning day
 *   P10 the Phase 5 api on the 020 schema (its reset and delete-all without the review deletes):
 *       delete-all; delete-all then a REST save; delete-all then an MCP course-quiz-check; a reset; a
 *       reset then the lesson finished again: each leaves review rows. The roll-forward listings
 *       (ROLL_FORWARD) find exactly them and the repairs delete exactly them (log by cascade);
 *       controls: cards entered after a Phase 6 delete-all, a Phase 6 reset and a re-opened
 *       account are untouched
 *   P11 the retention run leaves review_cards, review_log and progress_changed_at untouched
 *   P12 Japan-time days: due, reviewed_today, days_since and a grade's due_day from SQL equal the
 *       expected values for rows seeded n days back
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { exitCode, parseArgs } from './verify-account-deletion.mjs';
import { resetPoolForTests, setPoolForTests } from '../../server/db.js';
import { SQL as DELETION_SQL } from '../../server/services/accountDeletion.js';
import { readRetentionConfig, runRetention } from '../../server/services/retention.js';
import { reopenAccount } from '../../tools/core/accountDeletions.js';
import {
    DELETE_ALL_REVIEW_CARDS_SQL,
    DELETE_LESSON_REVIEW_CARDS_SQL,
    LEARNER_LOCK_SQL,
    applyQuizCheck,
    deleteAllLessonProgress,
    getLessonProgress,
    resetLessonProgress,
    saveLessonProgress,
} from '../../tools/core/lessonProgress.js';
import { getAchievements, noteReviewDay } from '../../tools/core/achievements.js';
import { getPublishedLesson } from '../../tools/core/courseCatalog.js';
import {
    GRADE_REVIEW_CARD_SQL,
    REVIEW_ROWS_SQL,
    enterReviewCards,
    getReviewQueue,
    gradeReviewCard,
    reviewCatalog,
    reviewDueForAgent,
    reviewGradeForAgent,
} from '../../tools/core/reviewQueue.js';
import { LESSON_PRIORS } from '../../shared/review/queue.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = path.join(ROOT, 'server', 'migrations');
const FILE = '020_review_queue.sql';
const ROLE = 'risepath_mcp_remote';
const ROLE_SQL = path.join(ROOT, 'deploy', 'risepath-vm', 'sql', 'mcp_remote_role.sql');
const TABLES = ['review_cards', 'review_log'];
const COURSE = 'vibe-coding';
const LESSON = 'vibe-ch1';
const HOLD_MS = 2000;
const LEAD_MS = 600;
/** A waiter counts as blocked when it waited at least this long. */
const BLOCKED_MS = HOLD_MS - LEAD_MS - 400;
const DAY_MS = 86400000;

/**
 * The roll-forward listings and repairs (design §3.10; the VM README's Phase 6 block): run as the
 * database owner after the VM ran the Phase 5 api image on the 020 schema, before the Phase 6 api,
 * mcp and mcp-public start. The log goes by cascade.
 */
export const ROLL_FORWARD = Object.freeze({
    listAccount: `SELECT c.user_id, count(*) AS cards FROM review_cards c
  JOIN lesson_progress_resets r USING (user_id)
 WHERE c.entered_at < r.reset_at GROUP BY 1`,
    repairAccount: `DELETE FROM review_cards c USING lesson_progress_resets r
 WHERE r.user_id = c.user_id AND c.entered_at < r.reset_at`,
    listLessons: `SELECT c.user_id, c.course_slug, c.lesson_id, count(*) AS cards FROM review_cards c
  JOIN lesson_progress_lesson_resets r USING (user_id, course_slug, lesson_id)
 WHERE c.entered_at < r.reset_at GROUP BY 1, 2, 3`,
    repairLessons: `DELETE FROM review_cards c USING lesson_progress_lesson_resets r
 WHERE r.user_id = c.user_id AND r.course_slug = c.course_slug AND r.lesson_id = c.lesson_id AND c.entered_at < r.reset_at`,
});

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
    return `abc6${n}-0000-4000-8000-${hex}`;
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

/** @param {pg.Pool | pg.PoolClient} db @param {string} sql @param {unknown[]} [params] */
const count = async (db, sql, params = []) => Number((await db.query(sql, params)).rows[0]?.n ?? NaN);
/** The SQLSTATE a statement fails with, or 'none'. @param {Promise<unknown>} promise */
const codeOf = (promise) => promise.then(() => 'none', (/** @type {any} */ e) => String(e?.code ?? e?.message));
/** date + n (YYYY-MM-DD). @param {string} day @param {number} n */
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** @param {pg.Pool} pool */
const todayOf = async (pool) => String((await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS d")).rows[0].d);
/** The Japan-time day of a timestamp, by the database. @param {pg.Pool} pool @param {unknown} at */
const jstDayOf = async (pool, at) => String((await pool.query("SELECT to_char(($1::timestamptz AT TIME ZONE 'Asia/Tokyo')::date, 'YYYY-MM-DD') AS d", [at])).rows[0].d);

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
 * The top-level statements of a migration (comments dropped; a $$ … $$ body stays whole).
 * @param {string} text
 * @returns {string[]}
 */
function statementsOf(text) {
    const lines = text.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
    /** @type {string[]} */
    const out = [];
    let current = '';
    let inBody = false;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines.startsWith('$$', i)) {
            inBody = !inBody;
            current += '$$';
            i += 1;
            continue;
        }
        const ch = lines[i];
        if (ch === ';' && !inBody) {
            if (current.trim()) out.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
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

const ch1 = /** @type {import('../../tools/core/courseCatalog.js').PublishedLesson} */ (getPublishedLesson(COURSE, LESSON));
/** @param {Record<string, unknown>} [overrides] */
const record = (overrides = {}) => ({ v: 1, seen: [], answers: {}, checks: {}, lastBlockId: null, updatedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });
/** vibe-ch1 read to the end. @param {Record<string, unknown>} [overrides] */
const finished = (overrides = {}) => record({ seen: [...ch1.index.readingBlockIds], ...overrides });

/** @param {pg.Pool} pool @param {string} tag */
async function stub(pool, tag) {
    const id = uid(tag);
    await pool.query('INSERT INTO auth.users (id) VALUES ($1)', [id]);
    return id;
}
/**
 * A REST save of one record (the current pool override). @param {string} userId @param {string} lessonId
 * @param {unknown} progress @param {{ epoch?: string | null, lessonEpoch?: string, course?: string }} [options]
 */
async function save(userId, lessonId, progress, { epoch = null, lessonEpoch, course = COURSE } = {}) {
    const saved = await saveLessonProgress({ userId, epoch, records: [{ courseSlug: course, lessonId, progress, ...(lessonEpoch ? { lessonEpoch } : {}) }] });
    if ('error_type' in saved || saved.records.length !== 1) throw new Error(`save failed: ${JSON.stringify(saved)}`);
    return saved.records[0];
}
/** A learner whose vibe-ch1 is finished and whose cards entered (a review read). @param {pg.Pool} pool @param {string} tag */
async function learnerWithCards(pool, tag) {
    const id = await stub(pool, tag);
    await save(id, LESSON, finished());
    const q = await getReviewQueue({ userId: id });
    if ('error_type' in q || q.inQueue !== 5) throw new Error(`entry failed: ${JSON.stringify(q)}`);
    return id;
}

/** A due Good prior learned `days` days ago (the lesson as its first rating). */
const SEED_PRIOR = `INSERT INTO review_cards (user_id, course_slug, lesson_id, card_id, learned_at, prior_rating, stability, difficulty, due_day)
VALUES ($1, $2, $3, $4, now() - make_interval(days => $5::int), 3, $6, $7, ((now() - make_interval(days => $5::int)) AT TIME ZONE 'Asia/Tokyo')::date + $8::int)`;
/** A card graded today (after a prior learned 5 days ago). */
const SEED_REVIEWED_TODAY = `INSERT INTO review_cards (user_id, course_slug, lesson_id, card_id, learned_at, prior_rating, stability, difficulty, reps, last_rating, last_review_day, due_day)
VALUES ($1, $2, $3, $4, now() - interval '5 days', 3, 10.96, 2.11, 1, 3, (now() AT TIME ZONE 'Asia/Tokyo')::date, (now() AT TIME ZONE 'Asia/Tokyo')::date + 11)`;
/** @param {pg.Pool} pool @param {string} user @param {string} course @param {string} lesson @param {string} card @param {number} [days] */
const seedPrior = (pool, user, course, lesson, card, days = 3) => pool.query(SEED_PRIOR, [user, course, lesson, card, days, LESSON_PRIORS.good.stability, LESSON_PRIORS.good.difficulty, LESSON_PRIORS.good.intervalDays]);
/** @param {pg.Pool} pool @param {string} user @param {string} course @param {string} lesson @param {string} card */
const seedReviewedToday = (pool, user, course, lesson, card) => pool.query(SEED_REVIEWED_TODAY, [user, course, lesson, card]);
/** @param {string} course @param {string} lesson */
const cardIds = (course, lesson) => [...reviewCatalog().values()].filter((c) => c.courseSlug === course && c.lessonId === lesson).map((c) => c.cardId);
/** @param {pg.Pool} pool @param {string} user */
const cardsOf = async (pool, user) => (await pool.query('SELECT * FROM review_cards WHERE user_id = $1 ORDER BY course_slug, lesson_id, card_id', [user])).rows;
/** @param {any[]} rows @returns {Record<string, any>} */
const byCard = (rows) => Object.fromEntries(rows.map((r) => [r.card_id, r]));
/** @param {pg.Pool} pool @param {string} user @param {string} [lesson] @returns {Promise<Date>} */
const changedAtOf = async (pool, user, lesson = LESSON) => (await pool.query('SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2', [user, lesson])).rows[0].t;
/** The published catalog plus card-added in vibe-ch1 (a card the author added later). */
function extendedCatalog() {
    const catalog = reviewCatalog();
    const base = /** @type {import('../../tools/core/reviewQueue.js').CatalogCard} */ (catalog.get(`${COURSE}/${LESSON}/card-frontend`));
    const extended = new Map(catalog);
    extended.set(`${COURSE}/${LESSON}/card-added`, { ...base, cardId: 'card-added', checkKey: 'card:cards/card-added', order: catalog.size });
    return extended;
}
/**
 * The entry with a catalog, in one transaction under the learner lock (as getReviewQueue runs it).
 * @param {pg.Pool} pool @param {string} user @param {import('../../tools/core/reviewQueue.js').ReviewCatalog} catalog
 */
async function enterWith(pool, user, catalog) {
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        await c.query(LEARNER_LOCK_SQL, [user]);
        const entered = await enterReviewCards(c, user, catalog);
        await c.query('COMMIT');
        return entered;
    } catch (error) {
        await c.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        c.release();
    }
}
/** @param {pg.Pool} pool @param {string} user */
const addedRow = async (pool, user) => (await pool.query("SELECT learned_at, prior_rating, stability, difficulty, to_char(due_day, 'YYYY-MM-DD') AS due FROM review_cards WHERE user_id = $1 AND card_id = 'card-added'", [user])).rows[0];
/** No memory, due the day after it entered. @param {any} row @param {string} today */
const noMemory = (row, today) => row?.learned_at === null && row.prior_rating === null && row.stability === null && row.difficulty === null && row.due === addDays(today, 1);
/**
 * Sets a lesson row's progress_changed_at past the trigger (as the in-app harness does); `extra` adds
 * SET items. updated_at stays the 016 trigger's now().
 * @param {pg.Pool} pool @param {string} user @param {string} lesson @param {string} at @param {string} [extra]
 */
async function backdate(pool, user, lesson, at, extra = '') {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE lesson_progress DISABLE TRIGGER lesson_progress_changed_at');
        await client.query(`UPDATE lesson_progress SET progress_changed_at = $3::timestamptz${extra} WHERE user_id = $1 AND course_slug = '${COURSE}' AND lesson_id = $2`, [user, lesson, at]);
        await client.query('ALTER TABLE lesson_progress ENABLE TRIGGER lesson_progress_changed_at');
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

/**
 * P1 (before 020 is applied; preId has a finished lesson on record): the review code answers "not
 * set up" (table_not_found: the route's 503, the MCP tools' review_unavailable), never 'unknown'.
 * The entry names lesson_progress.progress_changed_at, and PostgreSQL reports that missing column
 * (42703) before the missing review_cards; the grade's first review statement gets 42P01.
 * @param {pg.Pool} pool @param {string} preId
 */
async function p1Before020(pool, preId) {
    const inst = instrument(pool);
    try {
        const card = [...reviewCatalog().values()].find((c) => c.courseSlug === COURSE && c.lessonId === LESSON);
        const ids = { courseSlug: COURSE, lessonId: LESSON, cardId: card?.cardId };
        const answers = await quietly(async () => [
            await getReviewQueue({ userId: preId }),
            await gradeReviewCard({ userId: preId, ...ids, rating: 'good', source: 'web' }),
            await reviewDueForAgent({ userId: preId }),
            await reviewGradeForAgent({ userId: preId, ...ids, reveal: true }),
        ]);
        const types = answers.map((a) => /** @type {any} */ (a).error_type).join(',');
        const codes = inst.state.errors.join(',');
        check('P1', types === 'table_not_found,table_not_found,review_unavailable,review_unavailable' && codes === '42703,42P01,42703,42P01',
            `before 020, a finished lesson on record: queue, web grade, course-review-due, course-review-grade answer ${types} (SQLSTATEs ${codes}: the entry's missing progress_changed_at, then the grade's missing review_cards)`);
    } finally {
        resetPoolForTests();
    }
}

/**
 * P1 (before 020 is applied): 020 against an account deletion inside its DELETE, both orders, each
 * migration run rolled back; control: the other order of 020's statements deadlocks.
 * @param {pg.Pool} pool
 */
async function p1Order(pool) {
    const statements = statementsOf(await fs.readFile(path.join(MIGRATIONS, FILE), 'utf8'));
    const kinds = statements.map((s) => norm(s).split(' ').slice(0, 3).join(' '));
    check('P1', kinds.join('|') === 'create table if|create table if|alter table lesson_progress|create or replace|do $$ begin',
        `020's statements in order: ${kinds.join(', ')}`);
    /** A learner with a lesson_progress row, so the deletion's cascade needs lesson_progress. */
    const victim = async (/** @type {string} */ tag) => {
        const id = await stub(pool, tag);
        await pool.query(`INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, state, progress_updated_at) VALUES ($1, '${COURSE}', '${LESSON}', '{}', 'in_progress', now())`, [id]);
        return id;
    };
    /** @param {pg.PoolClient} c */
    const startDeletion = async (c, /** @type {string} */ id) => {
        await c.query('BEGIN');
        await c.query(DELETION_SQL.lock, [id]);
        await c.query(DELETION_SQL.lockStub, [id]);
    };

    // 1. 020 first: its first statement holds auth.users (SHARE ROW EXCLUSIVE); the deletion's DELETE
    //    waits before its cascade; 020 then alters lesson_progress and finishes; the deletion goes on.
    {
        const id = await victim('p1m');
        const m = await pool.connect();
        const d = await pool.connect();
        let outcome = '';
        let waited = 0;
        try {
            await m.query('BEGIN');
            await m.query(statements[0]);
            await startDeletion(d, id);
            const t0 = Date.now();
            const delP = d.query(DELETION_SQL.deleteStub, [id]).then(() => { waited = Date.now() - t0; return 'none'; }, (/** @type {any} */ e) => String(e.code));
            await sleep(LEAD_MS);
            const rest = [];
            for (const s of statements.slice(1)) rest.push(await codeOf(m.query(s)));
            await sleep(HOLD_MS - 2 * LEAD_MS);
            await m.query('ROLLBACK');
            const del = await delP;
            await d.query(del === 'none' ? 'COMMIT' : 'ROLLBACK');
            outcome = `020 ${rest.every((c) => c === 'none') ? 'ok' : rest.join(',')}, deletion ${del}`;
        } catch (error) {
            outcome = `failed ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`;
            await m.query('ROLLBACK').catch(() => {});
            await d.query('ROLLBACK').catch(() => {});
        } finally {
            m.release();
            d.release();
        }
        check('P1', outcome === '020 ok, deletion none' && waited >= BLOCKED_MS,
            `020 first, an account deletion's DELETE during it: the deletion waited ${waited} ms, then both finished (${outcome})`);
    }
    // 2. The deletion first: its DELETE (with the cascade into lesson_progress) has run; 020 waits
    //    at its first statement and finishes after the deletion commits.
    {
        const id = await victim('p1d');
        const m = await pool.connect();
        const d = await pool.connect();
        let outcome = '';
        let waited = 0;
        try {
            await startDeletion(d, id);
            await d.query(DELETION_SQL.deleteStub, [id]);
            await m.query('BEGIN');
            const t0 = Date.now();
            const migP = m.query(await fs.readFile(path.join(MIGRATIONS, FILE), 'utf8')).then(() => { waited = Date.now() - t0; return 'none'; }, (/** @type {any} */ e) => String(e.code));
            await sleep(HOLD_MS - LEAD_MS);
            await d.query('COMMIT');
            const mig = await migP;
            await m.query('ROLLBACK');
            outcome = `020 ${mig}`;
        } catch (error) {
            outcome = `failed ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`;
            await m.query('ROLLBACK').catch(() => {});
            await d.query('ROLLBACK').catch(() => {});
        } finally {
            m.release();
            d.release();
        }
        check('P1', outcome === '020 none' && waited >= BLOCKED_MS, `the deletion's DELETE first: 020 waited ${waited} ms, then applied (${outcome})`);
    }
    // 3. Control: the ALTER first (020 as first designed). 020 holds lesson_progress; the deletion's
    //    DELETE holds auth.users and its cascade waits for lesson_progress; 020's CREATE TABLE then
    //    waits for auth.users: 40P01.
    {
        const id = await victim('p1c');
        const m = await pool.connect();
        const d = await pool.connect();
        const codes = [];
        try {
            await m.query('BEGIN');
            await m.query(/** @type {string} */ (statements.find((s) => /^alter table lesson_progress/i.test(s))));
            await startDeletion(d, id);
            const delP = codeOf(d.query(DELETION_SQL.deleteStub, [id]));
            await sleep(LEAD_MS);
            codes.push(`020 ${await codeOf(m.query(statements[0]))}`);
            codes.push(`deletion ${await delP}`);
        } catch (error) {
            codes.push(`failed ${/** @type {any} */ (error).code}`);
        } finally {
            await m.query('ROLLBACK').catch(() => {});
            await d.query('ROLLBACK').catch(() => {});
            m.release();
            d.release();
        }
        check('P1', codes.some((c) => c.endsWith('40P01')), `control, the ALTER before the tables: ${codes.join(', ')} (a deadlock: the order is needed)`);
    }
}

/** @param {pg.Pool} pool @param {string} preId a learner whose lesson_progress row was written before 020 */
async function p1(pool, preId) {
    const { rows } = await pool.query(`SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS ref, c.confdeltype AS action,
            (SELECT string_agg(a.attname, ',' ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY AS k (attnum, n)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
        FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1) ORDER BY 1, 2`, [TABLES]);
    const got = rows.map((r) => `${r.tbl}(${r.cols})->${r.ref}:${r.action}`).join(' ');
    check('P1', got === 'review_cards(user_id)->auth.users:c review_log(user_id,course_slug,lesson_id,card_id)->review_cards:c',
        `the only FKs, once each after two runs: ${got}`);
    const grants = await count(pool, `SELECT (SELECT count(*) FROM information_schema.role_table_grants WHERE table_name = ANY($1) AND grantee <> current_user)
        + (SELECT count(*) FROM information_schema.role_column_grants WHERE table_name = ANY($1) AND grantee <> current_user) AS n`, [TABLES]);
    const triggers = await count(pool, "SELECT count(*) AS n FROM pg_trigger WHERE tgrelid = 'lesson_progress'::regclass AND tgname = 'lesson_progress_changed_at'");
    check('P1', grants === 0 && triggers === 1, `no grant on the two tables (${grants}); one lesson_progress_changed_at trigger (${triggers})`);

    // The trigger.
    const id = await stub(pool, 'p1t');
    const c = await pool.connect();
    /** @type {string[]} */
    const steps = [];
    try {
        const at = async () => (await c.query("SELECT progress_changed_at AS t, updated_at AS u FROM lesson_progress WHERE user_id = $1 AND lesson_id = 'vibe-ch1'", [id])).rows[0];
        const where = "WHERE user_id = $1 AND course_slug = 'vibe-coding' AND lesson_id = 'vibe-ch1'";
        // The write's time (clock_timestamp()), not the transaction's start (now()): 50 ms between them.
        const writeTime = `progress_changed_at >= now() + interval '40 milliseconds' AND progress_changed_at <= clock_timestamp()`;
        await c.query('BEGIN');
        await c.query('SELECT pg_sleep(0.05)');
        await c.query(`INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, progress_updated_at, progress_changed_at)
            VALUES ($1, 'vibe-coding', 'vibe-ch1', '{"a": 1, "b": [1, 2]}', now(), '2000-01-01')`, [id]);
        const inserted = (await c.query(`SELECT ${writeTime} AS same FROM lesson_progress ${where}`, [id])).rows[0].same;
        await c.query('COMMIT');
        steps.push(`insert sets the write's time, not the transaction's start (a sent value ignored): ${inserted}`);
        const t0 = (await at()).t.toISOString();
        await sleep(20);
        await c.query(`UPDATE lesson_progress SET pct = 5, state = 'in_progress', content_hash = 'sha256:x' ${where}`, [id]);
        steps.push(`write-back keeps: ${(await at()).t.toISOString() === t0}`);
        await c.query(`UPDATE lesson_progress SET progress = progress ${where}`, [id]);
        await c.query(`UPDATE lesson_progress SET progress = '{"b": [1, 2], "a": 1}' ${where}`, [id]);
        steps.push(`same progress (another key order) keeps: ${(await at()).t.toISOString() === t0}`);
        await c.query(`UPDATE lesson_progress SET progress_changed_at = '2000-01-01' ${where}`, [id]);
        steps.push(`a direct write is ignored: ${(await at()).t.toISOString() === t0}`);
        await c.query('BEGIN');
        await c.query('SELECT pg_sleep(0.05)');
        await c.query(`UPDATE lesson_progress SET progress = '{"a": 2, "b": [1, 2]}' ${where}`, [id]);
        const late = (await c.query(`SELECT ${writeTime} AND updated_at = now() AS late FROM lesson_progress ${where}`, [id])).rows[0].late;
        await c.query('COMMIT');
        const moved = await at();
        steps.push(`a progress change moves it, to the write's time (updated_at: the transaction's now()): ${moved.t.toISOString() > t0 && late === true}`);
        // A row written before 020 (NULL), then a write-back: its old updated_at is frozen in.
        const pre = (await c.query("SELECT progress_changed_at AS t, updated_at AS u FROM lesson_progress WHERE user_id = $1", [preId])).rows[0];
        await c.query("UPDATE lesson_progress SET pct = 7, content_hash = 'sha256:y' WHERE user_id = $1", [preId]);
        const after = (await c.query("SELECT progress_changed_at AS t, updated_at AS u FROM lesson_progress WHERE user_id = $1", [preId])).rows[0];
        steps.push(`a pre-020 row (${pre?.t === null ? 'NULL' : 'not NULL'}) keeps its old updated_at: ${pre?.t === null && after?.t?.getTime() === pre.u.getTime() && after.u.getTime() > pre.u.getTime()}`);
    } catch (error) {
        steps.push(`failed: ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`);
        await c.query('ROLLBACK').catch(() => {});
    } finally {
        c.release();
    }
    check('P1', steps.length === 6 && steps.every((s) => s.endsWith('true')), `progress_changed_at: ${steps.join('; ')}`);
}

/** @param {pg.Pool} pool */
async function p2(pool) {
    const id = await stub(pool, 'p2');
    const cols = ['user_id', 'course_slug', 'lesson_id', 'card_id', 'learned_at', 'prior_rating', 'stability', 'difficulty', 'reps', 'lapses', 'last_rating', 'last_review_day', 'due_day'];
    const today = "(now() AT TIME ZONE 'Asia/Tokyo')::date";
    /** A row as SQL expressions; overrides replace columns. @param {Record<string, string>} o */
    const card = (o) => {
        const base = {
            user_id: `'${id}'`, course_slug: "'c'", lesson_id: "'l'", card_id: "'card-a'", learned_at: "now() - interval '3 days'", prior_rating: '3',
            stability: '10.9', difficulty: '2.1', reps: '1', lapses: '0', last_rating: '3', last_review_day: `${today} - 1`, due_day: `${today} + 10`, ...o,
        };
        return `INSERT INTO review_cards (${cols.join(', ')}) VALUES (${cols.map((col) => /** @type {any} */ (base)[col]).join(', ')})`;
    };
    const prior = { reps: '0', last_rating: 'NULL', last_review_day: 'NULL', stability: '2.3065', difficulty: '2.1181', due_day: `(now() AT TIME ZONE 'Asia/Tokyo')::date - 1` };
    const log = (/** @type {Record<string, string>} */ o) => {
        const base = { card_id: "'card-ok'", rating: '3', elapsed_days: '2', interval_days: '11', stability: '10.9', difficulty: '2.1', source: "'web'", ...o };
        return `INSERT INTO review_log (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source)
            VALUES ('${id}', 'c', 'l', ${base.card_id}, ${base.rating}, ${base.elapsed_days}, ${base.interval_days}, ${base.stability}, ${base.difficulty}, ${base.source})`;
    };
    const valid = [await codeOf(pool.query(card({ card_id: "'card-ok'" }))), await codeOf(pool.query(card({ ...prior, card_id: "'card-prior'" }))),
        await codeOf(pool.query(card({ card_id: "'card-new'", learned_at: 'NULL', prior_rating: 'NULL', stability: 'NULL', difficulty: 'NULL', reps: '0', last_rating: 'NULL', last_review_day: 'NULL', due_day: `${today} + 1` })))];
    check('P2', valid.every((c) => c === 'none'), `a reviewed card, a lesson prior and a card with no memory insert (${valid.join(', ')})`);
    const cases = [
        ['due_day = last_review_day', card({ due_day: `${today} - 1` })],
        ['due_day = last_review_day + 366', card({ due_day: `${today} - 1 + 366` })],
        ['a prior due on its learned day', card({ ...prior, due_day: "((now() - interval '3 days') AT TIME ZONE 'Asia/Tokyo')::date" })],
        ['a prior due 366 days after it', card({ ...prior, due_day: "((now() - interval '3 days') AT TIME ZONE 'Asia/Tokyo')::date + 366" })],
        ['learned_at without prior_rating', card({ ...prior, prior_rating: 'NULL' })],
        ['a no-memory row with stability', card({ learned_at: 'NULL', prior_rating: 'NULL', difficulty: 'NULL', reps: '0', last_rating: 'NULL', last_review_day: 'NULL', due_day: `${today} + 1` })],
        ['stability 0', card({ stability: '0' })],
        ['difficulty 11', card({ difficulty: '11' })],
        ['card id Bad', card({ card_id: "'Bad'" })],
        ['card id of 81 characters', card({ card_id: `'${'a'.repeat(81)}'` })],
        ['lapses > reps', card({ lapses: '2' })],
        ['last_rating 2', card({ last_rating: '2' })],
        ['prior_rating 2', card({ ...prior, prior_rating: '2' })],
        ['reviewed before it was learned', card({ learned_at: 'now()' })],
        ['log rating 2', log({ rating: '2' })],
        ["log source 'app'", log({ source: "'app'" })],
        ['log elapsed_days 0', log({ elapsed_days: '0' })],
        ['log interval_days 366', log({ interval_days: '366' })],
        ['log interval_days 0', log({ interval_days: '0' })],
        ['log stability 0', log({ stability: '0' })],
    ];
    const codes = [];
    for (const [label, sql] of cases) codes.push(`${label}:${await codeOf(pool.query(sql))}`);
    const bad = codes.filter((c) => !c.endsWith(':23514'));
    check('P2', bad.length === 0, bad.length ? `accepted or failed otherwise: ${bad.join(', ')}` : `${codes.length} rows refused 23514 (${cases.map((c) => c[0]).join('; ')})`);
    const first = await codeOf(pool.query(log({})));
    const dup = await codeOf(pool.query(log({ rating: '1' })));
    const orphan = await codeOf(pool.query(log({ card_id: "'card-none'" })));
    const day = (await pool.query("SELECT review_day = (now() AT TIME ZONE 'Asia/Tokyo')::date AS today FROM review_log WHERE user_id = $1", [id])).rows[0];
    check('P2', first === 'none' && dup === '23505' && orphan === '23503' && day?.today === true,
        `a log row inserts with the database's day (${day?.today}); a second the same Japan-time day ${dup}; one for a card not in the queue ${orphan}`);
}

/** @param {pg.Pool} pool */
async function p3(pool) {
    instrument(pool);
    // The entry rules on real rows.
    {
        const id = await stub(pool, 'p3a');
        await save(id, LESSON, finished({ checks: { 'card:cards/card-api': false, 'card:cards/card-deploy': true } }));
        await save(id, 'vibe-ch2', record({ seen: ['hook-b1'], checks: { 'card:summary-cards/card-goal': true } }));
        await save(id, 'cc-04-verify', record({ checks: { 'card:summary-cards/card-gone': true, 'card:other-block/card-checks': true } }), { course: 'claude-code' });
        await save(id, 'cc-02-permissions', finished({ seen: ['hook-b1'] }), { course: 'claude-code' });
        const reset = await resetLessonProgress({ userId: id, epoch: null, courseSlug: 'claude-code', lessonId: 'cc-02-permissions' });
        if ('error_type' in reset) throw new Error(`P3 reset: ${reset.error_type}`);
        const q = await getReviewQueue({ userId: id });
        const rows = await cardsOf(pool, id);
        const day1 = await jstDayOf(pool, (await pool.query("SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1 AND lesson_id = 'vibe-ch1'", [id])).rows[0].t);
        const day2 = await jstDayOf(pool, (await pool.query("SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1 AND lesson_id = 'vibe-ch2'", [id])).rows[0].t);
        const fmt = (/** @type {any} */ r) => `${r.lesson_id}/${r.card_id}:${r.prior_rating}:${r.stability}:${r.difficulty}:${r.due_day.toISOString?.().slice(0, 10) ?? r.due_day}`;
        const { good, again } = LESSON_PRIORS;
        const want = [
            ...cardIds(COURSE, LESSON).map((card) => `vibe-ch1/${card}:${card === 'card-api' ? 1 : 3}:${card === 'card-api' ? again.stability : good.stability}:${card === 'card-api' ? again.difficulty : good.difficulty}:${addDays(day1, card === 'card-api' ? 1 : 2)}`),
            `vibe-ch2/card-goal:3:${good.stability}:${good.difficulty}:${addDays(day2, 2)}`,
        ].sort();
        const got = (await pool.query("SELECT lesson_id, card_id, prior_rating, stability, difficulty, to_char(due_day, 'YYYY-MM-DD') AS due_day FROM review_cards WHERE user_id = $1", [id])).rows.map(fmt).sort();
        check('P3', !('error_type' in q) && got.join('|') === want.join('|') && rows.every((r) => r.reps === 0 && r.last_review_day === null),
            `entry: vibe-ch1 finished (Good + 2; 「もう一度」 card-api Again + 1), vibe-ch2's 「覚えた」 mark alone (Good + 2); nothing from a mark on an unknown card or block, or from a tombstone: ${got.length} cards`);
        const before = JSON.stringify(rows);
        const again2 = await getReviewQueue({ userId: id });
        check('P3', !('error_type' in again2) && JSON.stringify(await cardsOf(pool, id)) === before, 'a second read adds nothing and changes nothing (entered_at included)');
    }
    // The Japan-time boundary of the learning day.
    {
        const id = await stub(pool, 'p3b');
        await save(id, LESSON, finished());
        await save(id, 'vibe-ch2', finished({ seen: [...(/** @type {any} */ (getPublishedLesson(COURSE, 'vibe-ch2'))).index.readingBlockIds] }));
        await backdate(pool, id, LESSON, '2026-10-24T14:59:59Z');
        await backdate(pool, id, 'vibe-ch2', '2026-10-24T15:00:00Z');
        await getReviewQueue({ userId: id });
        const due = (await pool.query("SELECT lesson_id, string_agg(DISTINCT to_char(due_day, 'YYYY-MM-DD'), ',') AS d FROM review_cards WHERE user_id = $1 GROUP BY 1 ORDER BY 1", [id])).rows.map((r) => `${r.lesson_id} ${r.d}`).join(', ');
        check('P3', due === 'vibe-ch1 2026-10-26, vibe-ch2 2026-10-27', `learned 14:59:59Z (JST the 24th) and 15:00:00Z (JST the 25th): due ${due}`);
    }
    // Critique 1: a GET write-back and an unchanged REST save before the first review read.
    {
        const id = await stub(pool, 'p3c');
        const progress = finished();
        await save(id, LESSON, progress);
        await backdate(pool, id, LESSON, new Date(Date.now() - 3 * DAY_MS).toISOString(), ", content_hash = 'stale'");
        const learned = (await pool.query('SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1', [id])).rows[0].t;
        await getLessonProgress({ userId: id, withEpoch: true });
        await save(id, LESSON, progress);
        const row = (await pool.query('SELECT progress_changed_at AS t, updated_at AS u, content_hash AS h FROM lesson_progress WHERE user_id = $1', [id])).rows[0];
        await getReviewQueue({ userId: id });
        const day = await jstDayOf(pool, learned);
        const cards = (await pool.query("SELECT DISTINCT learned_at = $2::timestamptz AS same, to_char(due_day, 'YYYY-MM-DD') AS due FROM review_cards WHERE user_id = $1", [id, learned])).rows;
        check('P3', row.h === ch1.hash && Date.now() - row.u.getTime() < 60_000 && row.t.getTime() === learned.getTime()
            && cards.length === 1 && cards[0].same === true && cards[0].due === addDays(day, 2),
            `learned 3 days ago; the GET wrote back (hash ${row.h === ch1.hash ? 'current' : row.h}, updated_at now), an unchanged save kept it; the cards: learned_at the learning time, due ${cards[0]?.due} (the learning day ${day} + 2)`);
    }
    // Critique 4: a card added to the lesson later (an extended catalog), and marks first.
    {
        const id = await stub(pool, 'p3d');
        await save(id, LESSON, finished());
        await getReviewQueue({ userId: id });
        const entered = await enterWith(pool, id, extendedCatalog());
        const today = await todayOf(pool);
        const added = await addedRow(pool, id);
        check('P3', entered === 1 && noMemory(added, today),
            `a card added after the learner's last change: ${entered} entered, no memory, due ${added?.due} (tomorrow)`);
        // Then the learner marks it in the lesson: its first rating is the lesson, dated the mark.
        await sleep(20);
        await save(id, LESSON, finished({ checks: { 'card:cards/card-added': false }, updatedAt: new Date(Date.now() - 1000).toISOString() }));
        await enterWith(pool, id, extendedCatalog());
        const marked = await addedRow(pool, id);
        const markedAt = await changedAtOf(pool, id);
        check('P3', marked?.prior_rating === 1 && marked.learned_at?.getTime() === markedAt.getTime() && marked.stability === LESSON_PRIORS.again.stability
            && marked.due === addDays(await jstDayOf(pool, markedAt), LESSON_PRIORS.again.intervalDays),
            `card-added marked 「もう一度」 later: prior ${marked?.prior_rating}, learned at the mark, due ${marked?.due}`);
        const e = await stub(pool, 'p3e');
        await save(e, LESSON, record({ seen: ['hook-b1'], checks: { 'card:cards/card-api': true } }));
        await getReviewQueue({ userId: e });
        const first = (await cardsOf(pool, e)).map((r) => r.card_id).join();
        await save(e, LESSON, finished({ checks: { 'card:cards/card-api': true }, updatedAt: new Date(Date.now() - 1000).toISOString() }));
        await getReviewQueue({ userId: e });
        const rows = await cardsOf(pool, e);
        const finishedAt = (await pool.query('SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1', [e])).rows[0].t;
        const rest = rows.filter((r) => r.card_id !== 'card-api');
        check('P3', first === 'card-api' && rows.length === 5 && rest.every((r) => r.prior_rating === 3 && r.learned_at.getTime() === finishedAt.getTime()),
            `marks first (${first}), then the finish: the other ${rest.length} cards get priors dated the finish`);
    }
    // fsrs-queue #1 / integrity #2: a card added after a later change of the lesson. With a read
    // between (checked_at), with every card marked (only checked_at tells), and with no read
    // between the revisit and the addition (an unmarked sibling tells).
    {
        const allMarked = Object.fromEntries(cardIds(COURSE, LESSON).map((card) => [`card:cards/${card}`, true]));
        for (const [tag, label, first, later, readBetween] of /** @type {[string, string, object, object, boolean][]} */ ([
            ['p3f', 'a new resume point a read saw', {}, { lastBlockId: ch1.index.readingBlockIds[1] }, true],
            ['p3g', 'every card marked, then a new resume point a read saw', { checks: allMarked }, { checks: allMarked, lastBlockId: ch1.index.readingBlockIds[1] }, true],
            ['p3h', 'a revisit no read saw', {}, { lastBlockId: ch1.index.readingBlockIds[1] }, false],
        ])) {
            const id = await stub(pool, tag);
            await save(id, LESSON, finished({ ...first, updatedAt: new Date(Date.now() - 2000).toISOString() }));
            await getReviewQueue({ userId: id });
            const entered = byCard(await cardsOf(pool, id));
            await sleep(20);
            await save(id, LESSON, finished({ ...later, updatedAt: new Date(Date.now() - 1000).toISOString() }));
            const changed = await changedAtOf(pool, id);
            if (readBetween) await getReviewQueue({ userId: id });
            const n = await enterWith(pool, id, extendedCatalog());
            const rows = await cardsOf(pool, id);
            const added = await addedRow(pool, id);
            const kept = rows.filter((r) => r.card_id !== 'card-added').every((r) => r.learned_at?.getTime() === entered[r.card_id].learned_at.getTime() && r.prior_rating === 3);
            const checked = rows.every((r) => r.checked_at?.getTime() === changed.getTime());
            check('P3', n === 1 && noMemory(added, await todayOf(pool)) && kept && (!readBetween || checked),
                `a card added after ${label}: no memory, due ${added?.due}; the others keep their learning time${readBetween ? `; checked_at moved to the change (${checked})` : ''}`);
        }
    }
    // integrity #1: until the first review, a later change of a mark gives the card its first rating again.
    {
        const id = await stub(pool, 'p3r');
        await save(id, LESSON, finished({ updatedAt: new Date(Date.now() - 2000).toISOString() }));
        await getReviewQueue({ userId: id });
        const entered = byCard(await cardsOf(pool, id));
        await sleep(20);
        await save(id, LESSON, finished({ checks: { 'card:cards/card-api': false }, updatedAt: new Date(Date.now() - 1000).toISOString() }));
        const changed = await changedAtOf(pool, id);
        await getReviewQueue({ userId: id });
        const rows = byCard(await cardsOf(pool, id));
        const api = rows['card-api'];
        const { again } = LESSON_PRIORS;
        const others = cardIds(COURSE, LESSON).filter((card) => card !== 'card-api');
        const apiDue = String((await pool.query("SELECT to_char(due_day, 'YYYY-MM-DD') AS d FROM review_cards WHERE user_id = $1 AND card_id = 'card-api'", [id])).rows[0].d);
        check('P3', api.prior_rating === 1 && api.stability === again.stability && api.difficulty === again.difficulty && api.learned_at.getTime() === changed.getTime()
            && apiDue === addDays(await jstDayOf(pool, changed), again.intervalDays)
            && others.every((card) => rows[card].prior_rating === 3 && rows[card].learned_at.getTime() === entered[card].learned_at.getTime()),
            `a 「もう一度」 after the entry: card-api Again (S ${api.stability}), learned at the change; the others keep Good and their time`);
        const held = JSON.stringify(await cardsOf(pool, id));
        await getReviewQueue({ userId: id });
        check('P3', JSON.stringify(await cardsOf(pool, id)) === held, 'a re-read with no change writes nothing (no memory wiped)');
        // A reviewed card (reps 1) keeps the queue's memory when the learner marks it in the lesson.
        await pool.query(`UPDATE review_cards SET learned_at = now() - interval '5 days', reps = 1, last_rating = 3, last_review_day = (now() AT TIME ZONE 'Asia/Tokyo')::date,
                          stability = 10.9, difficulty = 2.1, due_day = (now() AT TIME ZONE 'Asia/Tokyo')::date + 10 WHERE user_id = $1 AND card_id = 'card-frontend'`, [id]);
        const reviewed = JSON.stringify(byCard(await cardsOf(pool, id))['card-frontend']);
        await sleep(20);
        await save(id, LESSON, finished({ checks: { 'card:cards/card-api': false, 'card:cards/card-frontend': false }, updatedAt: new Date(Date.now() - 1000).toISOString() }));
        await getReviewQueue({ userId: id });
        const now = byCard(await cardsOf(pool, id))['card-frontend'];
        check('P3', JSON.stringify({ ...now, checked_at: JSON.parse(reviewed).checked_at }) === reviewed,
            'a 「もう一度」 on a reviewed card changes nothing but checked_at');
    }
    // A write whose transaction began before a REST save and wrote after it (an MCP writer locks only
    // the row and takes no learner lock): a review read between them entered the save's mark; the
    // write then finishes the lesson. Its progress_changed_at is its write time (later than the
    // mark's), so the next read gives the other cards their priors. With now() it would be the
    // transaction's start, earlier than the mark's learned_at, and they would enter as added later.
    {
        const id = await stub(pool, 'p3m');
        const m = await pool.connect();
        let began = null;
        try {
            await m.query('BEGIN');
            began = (await m.query('SELECT now() AS t')).rows[0].t;
            await sleep(20);
            await save(id, LESSON, record({ seen: ['hook-b1'], checks: { 'card:cards/card-api': true } }));
            await getReviewQueue({ userId: id });
            await m.query(`UPDATE lesson_progress SET progress = $2::jsonb, state = 'read' WHERE user_id = $1 AND course_slug = '${COURSE}' AND lesson_id = '${LESSON}'`,
                [id, JSON.stringify(finished({ checks: { 'card:cards/card-api': true } }))]);
            await m.query('COMMIT');
        } catch (error) {
            await m.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            m.release();
        }
        await getReviewQueue({ userId: id });
        const rows = await cardsOf(pool, id);
        const marked = rows.find((r) => r.card_id === 'card-api');
        const finishedAt = (await pool.query('SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1', [id])).rows[0].t;
        const rest = rows.filter((r) => r.card_id !== 'card-api');
        check('P3', rows.length === 5 && marked?.learned_at > began && finishedAt > marked.learned_at
            && rest.every((r) => r.prior_rating === 3 && r.learned_at?.getTime() === finishedAt.getTime()),
            `a write that began (${began?.toISOString()}) before a save's mark (learned ${marked?.learned_at?.toISOString()}) and finished the lesson after it: progress_changed_at ${finishedAt?.toISOString()} (its write time); the other ${rest.length} cards: priors ${rest.map((r) => r.prior_rating).join(',')}`);
    }
}

/**
 * Runs the shipped role SQL through psql (a random password). @param {string} url
 * @returns {{ status: number | null, stderr: string, version: string } | null} null without psql
 */
function runRoleSql(url) {
    const psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
    if (psql.status !== 0) return null;
    const password = crypto.randomBytes(16).toString('hex');
    const run = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `mcp_password=${password}`, '-d', url, '-f', ROLE_SQL], { encoding: 'utf8' });
    return { status: run.status, stderr: run.stderr, version: psql.stdout.trim() };
}

/**
 * P4: the review tools as risepath_mcp_remote with the shipped role SQL.
 * @param {pg.Pool} pool @param {string} url @returns {Promise<boolean>} whether the role was created
 */
async function p4(pool, url) {
    const run = runRoleSql(url);
    if (!run) {
        skip('P4', 'psql is not on PATH: the role SQL cannot run here');
        return false;
    }
    check('P4', run.status === 0, `deploy/risepath-vm/sql/mcp_remote_role.sql through ${run.version}: exit ${run.status}${run.status ? ` ${run.stderr.trim().split('\n').slice(-2).join(' ')}` : ''}`);
    if (run.status !== 0) return true;

    // What the catalog says the role may and may not do (as the superuser).
    /** @type {[string, string, string, boolean][]} table, column ('' = any column), privilege, granted */
    const want = [
        ['review_cards', 'learned_at', 'SELECT', true], ['review_cards', 'due_day', 'UPDATE', true], ['review_cards', 'prior_rating', 'INSERT', true],
        ['review_cards', 'entered_at', 'SELECT', false], ['review_cards', 'entered_at', 'INSERT', false], ['review_cards', 'entered_at', 'UPDATE', false],
        ['review_cards', 'prior_rating', 'SELECT', false], ['review_cards', 'prior_rating', 'UPDATE', true], ['review_cards', 'learned_at', 'UPDATE', true],
        ['review_cards', 'last_rating', 'SELECT', false], ['review_cards', 'last_rating', 'UPDATE', true],
        ['review_cards', 'checked_at', 'SELECT', true], ['review_cards', 'checked_at', 'INSERT', true], ['review_cards', 'checked_at', 'UPDATE', true],
        ['review_log', 'source', 'INSERT', true], ['review_log', '', 'SELECT', false], ['review_log', '', 'UPDATE', false],
        ['review_log', 'review_day', 'INSERT', false], ['review_log', 'reviewed_at', 'INSERT', false],
        ['learning_days', '', 'SELECT', false], ['learning_days', '', 'INSERT', false], ['xp_awards', '', 'SELECT', false], ['lesson_progress_lesson_resets', '', 'SELECT', false],
    ];
    const wrong = [];
    for (const [table, column, privilege, granted] of want) {
        const got = column
            ? (await pool.query('SELECT has_column_privilege($1, $2, $3, $4) AS p', [ROLE, table, column, privilege])).rows[0].p
            : (await pool.query('SELECT has_any_column_privilege($1, $2, $3) AS p', [ROLE, table, privilege])).rows[0].p;
        if (got !== granted) wrong.push(`${privilege} ${table}${column ? `.${column}` : ''} ${got}`);
    }
    for (const table of TABLES) {
        for (const privilege of ['DELETE', 'TRUNCATE']) {
            if ((await pool.query('SELECT has_table_privilege($1, $2, $3) AS p', [ROLE, table, privilege])).rows[0].p) wrong.push(`${privilege} ${table}`);
        }
    }
    check('P4', wrong.length === 0, `the catalog: ${want.length} column privileges as listed, no DELETE or TRUNCATE on either table${wrong.length ? `; wrong: ${wrong.join(', ')}` : ''}`);

    // A learner whose vibe-ch1 the app saved 3 days ago (no review row yet).
    instrument(pool);
    const id = await stub(pool, 'p4');
    await save(id, LESSON, finished());
    const learned = new Date(Date.now() - 3 * DAY_MS).toISOString();
    await backdate(pool, id, LESSON, learned);
    const daysBefore = await count(pool, 'SELECT count(*) AS n FROM learning_days WHERE user_id = $1', [id]);
    const rolePool = new pg.Pool({ connectionString: url, max: 2, options: `-c role=${ROLE}` });
    try {
        const whoami = (await rolePool.query('SELECT current_user AS u')).rows[0].u;
        const inst = instrument(rolePool);
        const due = /** @type {any} */ (await reviewDueForAgent({ userId: id }));
        const rows = await cardsOf(pool, id);
        const day = await jstDayOf(pool, learned);
        const backs = cardIds(COURSE, LESSON).map((card) => /** @type {any} */ (reviewCatalog().get(`${COURSE}/${LESSON}/${card}`)).back.jp);
        const text = JSON.stringify(due);
        check('P4', whoami === ROLE && !due.error_type && due.cards?.length === 5 && rows.length === 5
            && rows.every((r) => r.prior_rating === 3 && r.learned_at?.getTime() === new Date(learned).getTime())
            && backs.every((back) => !text.includes(back)) && inst.state.errors.length === 0,
            `as ${whoami}: course-review-due entered ${rows.length} cards (learned ${day}, Good priors) and listed ${due.cards?.length} fronts, no back (${due.error_type ?? 'ok'}; errors ${inst.state.errors.join(',') || 'none'})`);
        const dueDays = (await pool.query("SELECT DISTINCT to_char(due_day, 'YYYY-MM-DD') AS d FROM review_cards WHERE user_id = $1", [id])).rows.map((r) => r.d).join();
        check('P4', dueDays === addDays(day, 2), `the cards are due the learning day + 2 (${dueDays}; learned ${day})`);

        // A card added to the lesson later, entered as the role (the studied rule reads checked_at
        // and the siblings' marks).
        const base = /** @type {import('../../tools/core/reviewQueue.js').CatalogCard} */ (reviewCatalog().get(`${COURSE}/${LESSON}/card-frontend`));
        const entered = await enterWith(rolePool, id, extendedCatalog());
        const added = await addedRow(pool, id);
        check('P4', entered === 1 && noMemory(added, await todayOf(pool)),
            `as ${ROLE}: a card added later entered with no memory, due ${added?.due} (tomorrow)`);
        await pool.query("DELETE FROM review_cards WHERE user_id = $1 AND card_id = 'card-added'", [id]);

        // integrity #1 as the role: a later 「もう一度」 (saved by the app) gives card-api the Again
        // prior through the entry's ON CONFLICT DO UPDATE, which never reads prior_rating; a re-read
        // with no change writes nothing.
        instrument(pool);
        await save(id, LESSON, finished({ checks: { 'card:cards/card-api': false }, updatedAt: new Date(Date.now() - 1000).toISOString() }));
        const markedAt = await changedAtOf(pool, id);
        const inst2 = instrument(rolePool);
        const afterMark = /** @type {any} */ (await reviewDueForAgent({ userId: id }));
        const api = byCard(await cardsOf(pool, id))['card-api'];
        const heldRows = JSON.stringify(await cardsOf(pool, id));
        await reviewDueForAgent({ userId: id });
        check('P4', !afterMark.error_type && inst2.state.errors.length === 0 && api.prior_rating === 1 && api.stability === LESSON_PRIORS.again.stability
            && api.learned_at.getTime() === markedAt.getTime() && JSON.stringify(await cardsOf(pool, id)) === heldRows,
            `as ${ROLE}: a later 「もう一度」 gave card-api the Again prior (${api.prior_rating}, S ${api.stability}) dated the mark; a re-read wrote nothing (errors ${inst2.state.errors.join(',') || 'none'})`);

        const args = { userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: 'card-frontend' };
        const backJp = /** @type {{ jp: string }} */ (base.back).jp;
        const reveal = /** @type {any} */ (await reviewGradeForAgent({ ...args, reveal: true }));
        const logAfterReveal = await count(pool, 'SELECT count(*) AS n FROM review_log WHERE user_id = $1', [id]);
        const rated = /** @type {any} */ (await reviewGradeForAgent({ ...args, rating: 'good' }));
        const second = /** @type {any} */ (await reviewGradeForAgent({ ...args, rating: 'again' }));
        const log = (await pool.query("SELECT source, rating, elapsed_days, to_char(review_day, 'YYYY-MM-DD') AS d FROM review_log WHERE user_id = $1", [id])).rows;
        const today = await todayOf(pool);
        check('P4', reveal.recorded === false && reveal.back === backJp && logAfterReveal === 0
            && rated.recorded === true && rated.back === backJp && rated.next_review_day === addDays(today, rated.next_review_in_days)
            && second.error_type === 'not_due' && second.reviewed_today === true && second.due_on === rated.next_review_day
            && log.length === 1 && log[0].source === 'mcp' && log[0].rating === 3 && log[0].elapsed_days === 3 && log[0].d === today && inst2.state.errors.length === 0,
            `as ${ROLE}: reveal (recorded ${reveal.recorded}, ${logAfterReveal} log rows), rating good (next ${rated.next_review_day}, in ${rated.next_review_in_days} days), a second rating ${second.error_type} (reviewed_today ${second.reviewed_today}); log ${log.map((l) => `${l.source}:${l.rating}:${l.elapsed_days}`).join(',')}`);
        const daysAfter = await count(pool, 'SELECT count(*) AS n FROM learning_days WHERE user_id = $1', [id]);
        check('P4', daysAfter === daysBefore, `an MCP review wrote no learning day (${daysBefore} → ${daysAfter})`);
        // A mark on the card just reviewed changes nothing as the role (reps 1).
        const gradedRow = JSON.stringify({ ...byCard(await cardsOf(pool, id))['card-frontend'], checked_at: null });
        instrument(pool);
        await save(id, LESSON, finished({ checks: { 'card:cards/card-api': false, 'card:cards/card-frontend': false }, updatedAt: new Date(Date.now() - 500).toISOString() }));
        instrument(rolePool);
        const afterReviewedMark = /** @type {any} */ (await reviewDueForAgent({ userId: id }));
        check('P4', !afterReviewedMark.error_type && JSON.stringify({ ...byCard(await cardsOf(pool, id))['card-frontend'], checked_at: null }) === gradedRow,
            `as ${ROLE}: a 「もう一度」 on a reviewed card kept its memory`);

        // Refused to the role (42501).
        const refused = [
            ['DELETE FROM review_cards WHERE user_id = $1', [id]],
            ['SELECT * FROM review_cards WHERE user_id = $1', [id]],
            ['SELECT entered_at FROM review_cards WHERE user_id = $1', [id]],
            ['SELECT prior_rating FROM review_cards WHERE user_id = $1', [id]],
            ['SELECT last_rating FROM review_cards WHERE user_id = $1', [id]],
            ["INSERT INTO review_cards (user_id, course_slug, lesson_id, card_id, due_day, entered_at) VALUES ($1, 'vibe-coding', 'vibe-ch1', 'card-x', current_date + 1, now())", [id]],
            ['UPDATE review_cards SET entered_at = now() WHERE user_id = $1', [id]],
            ['SELECT * FROM review_log', []],
            ['SELECT count(*) FROM review_log WHERE user_id = $1', [id]],
            ["INSERT INTO review_log (user_id, course_slug, lesson_id, card_id, rating, interval_days, stability, difficulty, source, review_day) VALUES ($1, 'vibe-coding', 'vibe-ch1', 'card-api', 3, 2, 2.3, 2.1, 'mcp', '2000-01-01')", [id]],
            ['INSERT INTO learning_days (user_id, day) VALUES ($1, current_date)', [id]],
            ['SELECT * FROM lesson_progress_lesson_resets', []],
            ['SELECT * FROM xp_awards', []],
        ];
        const codes = [];
        for (const [sql, params] of refused) codes.push(await codeOf(rolePool.query(/** @type {string} */ (sql), /** @type {unknown[]} */ (params))));
        check('P4', codes.every((code) => code === '42501'), `refused to the role: ${refused.length} statements → ${[...new Set(codes)].join(', ')}`);
        const changedBefore = (await pool.query('SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1', [id])).rows[0].t;
        const upd = await codeOf(rolePool.query("UPDATE lesson_progress SET progress_changed_at = '2000-01-01' WHERE user_id = $1", [id]));
        const changedAfter = (await pool.query('SELECT progress_changed_at AS t FROM lesson_progress WHERE user_id = $1', [id])).rows[0].t;
        check('P4', upd === 'none' && changedAfter.getTime() === changedBefore.getTime(),
            `the role's UPDATE of progress_changed_at (${upd}) is ignored: ${changedAfter.toISOString()} kept`);

        // Before the owner re-runs the role SQL (a migration's new table without its grant): both
        // tools answer review_unavailable; re-running the role SQL brings them back.
        await pool.query(`REVOKE ALL ON review_cards, review_log FROM ${ROLE}`);
        const offDue = /** @type {any} */ (await quietly(() => reviewDueForAgent({ userId: id })));
        const offGrade = /** @type {any} */ (await quietly(() => reviewGradeForAgent({ ...args, cardId: 'card-api', reveal: true })));
        const rerun = runRoleSql(url);
        const back = /** @type {any} */ (await reviewDueForAgent({ userId: id }));
        check('P4', offDue.error_type === 'review_unavailable' && offGrade.error_type === 'review_unavailable' && rerun?.status === 0 && !back.error_type,
            `without the review grants: due ${offDue.error_type}, grade ${offGrade.error_type}; after the role SQL again (exit ${rerun?.status}): ${back.error_type ?? 'ok'}`);
    } finally {
        await rolePool.end();
        instrument(pool);
    }
    return true;
}

/** @param {pg.Pool} pool */
async function p5(pool) {
    for (const [first, second] of [['web', 'mcp'], ['mcp', 'web']]) {
        const inst = instrument(pool);
        const id = await stub(pool, `p5${first}`);
        await seedPrior(pool, id, COURSE, LESSON, 'card-frontend');
        const args = { userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: 'card-frontend', rating: 'good' };
        const hold = inst.holdBefore((text) => text === 'commit');
        const firstP = gradeReviewCard({ ...args, source: first });
        await hold.reached;
        const t0 = Date.now();
        const secondP = gradeReviewCard({ ...args, rating: 'again', source: second }).then((r) => ({ r, waited: Date.now() - t0 }));
        await sleep(HOLD_MS - LEAD_MS);
        hold.release();
        const a = /** @type {any} */ (await firstP);
        const { r: b, waited } = /** @type {{ r: any, waited: number }} */ (await secondP);
        const log = (await pool.query('SELECT source, rating FROM review_log WHERE user_id = $1', [id])).rows;
        check('P5', !a.error_type && b.error_type === 'not_due' && b.reviewedToday === true && waited >= BLOCKED_MS && log.length === 1 && log[0].source === first && log[0].rating === 3,
            `${first} then ${second} on one card: ${a.error_type ?? 'recorded'}, the second waited ${waited} ms and got ${b.error_type} (reviewedToday ${b.reviewedToday}); log ${log.map((l) => `${l.source}:${l.rating}`).join(',')}`);
    }
    {
        const inst = instrument(pool);
        const id = await stub(pool, 'p5cap');
        for (const card of cardIds('claude-code', 'cc-04-verify')) await seedReviewedToday(pool, id, 'claude-code', 'cc-04-verify', card);
        for (const card of cardIds('claude-code', 'cc-03-plan-first').slice(0, 2)) await seedReviewedToday(pool, id, 'claude-code', 'cc-03-plan-first', card);
        await seedPrior(pool, id, COURSE, LESSON, 'card-frontend');
        await seedPrior(pool, id, COURSE, LESSON, 'card-api');
        const done = await count(pool, "SELECT count(*) AS n FROM review_cards WHERE user_id = $1 AND last_review_day = (now() AT TIME ZONE 'Asia/Tokyo')::date", [id]);
        const hold = inst.holdBefore((text) => text === 'commit');
        const aP = gradeReviewCard({ userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: 'card-frontend', rating: 'good', source: 'web' });
        await hold.reached;
        const t0 = Date.now();
        const bP = gradeReviewCard({ userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: 'card-api', rating: 'good', source: 'mcp' }).then((r) => ({ r, waited: Date.now() - t0 }));
        await sleep(HOLD_MS - LEAD_MS);
        hold.release();
        const a = /** @type {any} */ (await aP);
        const { r: b, waited } = /** @type {{ r: any, waited: number }} */ (await bP);
        check('P5', done === 9 && !a.error_type && b.error_type === 'review_limit' && b.doneToday === 10 && waited >= BLOCKED_MS,
            `two cards at ${done} done: ${a.error_type ?? 'recorded'}, the other waited ${waited} ms and got ${b.error_type} (${b.doneToday} done)`);
    }
    {
        const inst = instrument(pool);
        const id = await stub(pool, 'p5s');
        await seedPrior(pool, id, COURSE, LESSON, 'card-frontend');
        const hold = inst.holdBefore((text) => text === 'commit');
        const saveP = saveLessonProgress({ userId: id, epoch: null, records: [{ courseSlug: COURSE, lessonId: 'vibe-ch2', progress: record({ seen: ['hook-b1'] }) }] });
        await hold.reached;
        const t0 = Date.now();
        const gradeP = gradeReviewCard({ userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: 'card-frontend', rating: 'good', source: 'web' }).then((r) => ({ r, waited: Date.now() - t0 }));
        await sleep(HOLD_MS - LEAD_MS);
        hold.release();
        const saved = await saveP;
        const { r, waited } = /** @type {{ r: any, waited: number }} */ (await gradeP);
        check('P5', !('error_type' in saved) && !r.error_type && waited >= BLOCKED_MS, `a grade waited ${waited} ms for a REST save holding the learner lock, then recorded (${r.error_type ?? 'ok'})`);
    }
}

/** @param {pg.Pool} pool */
async function p6(pool) {
    const resetArgs = (/** @type {string} */ id) => ({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
    // The reset first: the entry waits on the learner lock and then sees the tombstone.
    {
        const inst = instrument(pool);
        const id = await learnerWithCards(pool, 'p6r');
        const hold = inst.holdBefore((text) => text === 'commit');
        const resetP = resetLessonProgress(resetArgs(id));
        await hold.reached;
        const t0 = Date.now();
        const readP = getReviewQueue({ userId: id }).then((r) => ({ r, waited: Date.now() - t0 }));
        await sleep(HOLD_MS - LEAD_MS);
        hold.release();
        const reset = await resetP;
        const { r, waited } = await readP;
        const left = await count(pool, 'SELECT count(*) AS n FROM review_cards WHERE user_id = $1', [id]);
        check('P6', !('error_type' in reset) && !('error_type' in r) && waited >= BLOCKED_MS && left === 0,
            `a reset holding the learner lock: the review read waited ${waited} ms, then entered nothing (${left} cards)`);
    }
    // The entry first: the reset waits and deletes what it entered.
    {
        const inst = instrument(pool);
        const id = await stub(pool, 'p6e');
        await save(id, LESSON, finished());
        const hold = inst.holdBefore((text) => text === 'commit');
        const readP = getReviewQueue({ userId: id });
        await hold.reached;
        const t0 = Date.now();
        const resetP = resetLessonProgress(resetArgs(id)).then((r) => ({ r, waited: Date.now() - t0 }));
        await sleep(HOLD_MS - LEAD_MS);
        hold.release();
        const read = /** @type {any} */ (await readP);
        const { r, waited } = await resetP;
        const left = await count(pool, 'SELECT count(*) AS n FROM review_cards WHERE user_id = $1', [id]);
        check('P6', read.inQueue === 5 && !('error_type' in r) && waited >= BLOCKED_MS && left === 0,
            `an entry holding the learner lock (${read.inQueue} cards): the reset waited ${waited} ms, then deleted them (${left} left)`);
    }
    // The same, the reset given the id in upper case (the lock key is the canonical id for every caller).
    {
        const inst = instrument(pool);
        const id = await stub(pool, 'p6u');
        await save(id, LESSON, finished());
        const hold = inst.holdBefore((text) => text === 'commit');
        const readP = getReviewQueue({ userId: id });
        await hold.reached;
        const t0 = Date.now();
        const resetP = resetLessonProgress(resetArgs(id.toUpperCase())).then((r) => ({ r, waited: Date.now() - t0 }));
        await sleep(HOLD_MS - LEAD_MS);
        hold.release();
        const read = /** @type {any} */ (await readP);
        const { r, waited } = await resetP;
        const left = await count(pool, 'SELECT count(*) AS n FROM review_cards WHERE user_id = $1', [id]);
        check('P6', read.inQueue === 5 && !('error_type' in r) && waited >= BLOCKED_MS && left === 0,
            `the same with the reset given an upper-case id: it waited ${waited} ms, then deleted them (${left} left)`);
    }
    // Control: the entry without LEARNER_LOCK_SQL during a reset brings the cards back.
    {
        const inst = instrument(pool);
        const id = await learnerWithCards(pool, 'p6c');
        const hold = inst.holdBefore((text) => text === 'commit');
        const resetP = resetLessonProgress(resetArgs(id));
        await hold.reached;
        const lock = norm(LEARNER_LOCK_SQL);
        inst.state.skip = (text) => text === lock;
        const readP = getReviewQueue({ userId: id });
        await sleep(LEAD_MS);
        hold.release();
        const reset = await resetP;
        const read = await readP;
        inst.state.skip = null;
        const back = await count(pool, 'SELECT count(*) AS n FROM review_cards WHERE user_id = $1', [id]);
        const early = await count(pool, `SELECT count(*) AS n FROM review_cards c JOIN lesson_progress_lesson_resets r USING (user_id, course_slug, lesson_id)
            WHERE c.user_id = $1 AND c.entered_at < r.reset_at`, [id]);
        check('P6', !('error_type' in reset) && !('error_type' in read) && back > 0,
            `control without the learner lock: the read started during the reset put ${back} cards of the restarted lesson back (the lock is needed; ${early} of them stamped before the reset's reset_at)`);
        // The control's leftovers would be listed by the roll-forward repair (P10 lists the whole database).
        await pool.query('DELETE FROM review_cards WHERE user_id = $1', [id]);
    }
    // An entry that began before a delete-all and ran after it: entered_at is after reset_at.
    {
        const inst = instrument(pool);
        const id = await stub(pool, 'p6d');
        await save(id, LESSON, finished());
        const lock = norm(LEARNER_LOCK_SQL);
        const hold = inst.holdBefore((text) => text === lock);
        const readP = getReviewQueue({ userId: id });
        await hold.reached;
        const began = Date.now();
        const deleted = await deleteAllLessonProgress({ userId: id });
        if ('error_type' in deleted) throw new Error(`P6 delete-all: ${deleted.error_type}`);
        await save(id, LESSON, finished(), { epoch: deleted.epoch });
        hold.release();
        const read = /** @type {any} */ (await readP);
        const row = (await pool.query(`SELECT min(c.entered_at) AS entered, r.reset_at AS reset FROM review_cards c JOIN lesson_progress_resets r USING (user_id)
            WHERE c.user_id = $1 GROUP BY r.reset_at`, [id])).rows[0];
        const listed = (await pool.query(ROLL_FORWARD.listAccount)).rows.some((r) => r.user_id === id);
        check('P6', read.inQueue === 5 && row && row.entered > row.reset && row.reset.getTime() >= began - 1000 && !listed,
            `an entry whose transaction began before a delete-all and ran after it: entered_at ${row?.entered?.toISOString()} > reset_at ${row?.reset?.toISOString()} (clock_timestamp(), not the transaction's start); the roll-forward listing leaves it (${listed ? 'listed' : 'not listed'})`);
    }
}

/** @param {pg.Pool} pool */
async function p7(pool) {
    instrument(pool);
    const id = await stub(pool, 'p7');
    await save(id, LESSON, finished());
    await save(id, 'cc-04-verify', record({ checks: { 'card:summary-cards/card-checks': true } }), { course: 'claude-code' });
    await getAchievements({ userId: id });
    await pool.query("INSERT INTO learning_days (user_id, day) VALUES ($1, (now() AT TIME ZONE 'Asia/Tokyo')::date - 3)", [id]);
    for (const card of cardIds(COURSE, LESSON)) await seedPrior(pool, id, COURSE, LESSON, card);
    await seedPrior(pool, id, 'claude-code', 'cc-04-verify', 'card-checks');
    for (const card of ['card-frontend', 'card-api']) {
        const r = /** @type {any} */ (await gradeReviewCard({ userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: card, rating: 'good', source: 'web' }));
        if (r.error_type) throw new Error(`P7 grade: ${r.error_type}`);
    }
    await gradeReviewCard({ userId: id, courseSlug: 'claude-code', lessonId: 'cc-04-verify', cardId: 'card-checks', rating: 'again', source: 'mcp' });
    const kept = async () => JSON.stringify({
        xp: (await pool.query("SELECT string_agg(item_key || ' ' || milestone, ',' ORDER BY item_key, milestone) AS s FROM xp_awards WHERE user_id = $1", [id])).rows[0].s,
        days: (await pool.query("SELECT string_agg(day::text, ',' ORDER BY day) AS s FROM learning_days WHERE user_id = $1", [id])).rows[0].s,
    });
    const n = async (/** @type {string} */ table) => (await pool.query(`SELECT string_agg(lesson_id, ',' ORDER BY lesson_id, card_id) AS s FROM ${table} WHERE user_id = $1`, [id])).rows[0].s;
    const before = await kept();
    const reset = await resetLessonProgress({ userId: id, epoch: null, courseSlug: COURSE, lessonId: LESSON });
    const afterReset = { cards: await n('review_cards'), log: await n('review_log'), kept: await kept(), gens: await count(pool, 'SELECT count(*) AS n FROM lesson_progress_lesson_resets WHERE user_id = $1', [id]) };
    check('P7', !('error_type' in reset) && afterReset.cards === 'cc-04-verify' && afterReset.log === 'cc-04-verify' && afterReset.kept === before && afterReset.gens === 1,
        `the reset of vibe-ch1 deleted its cards and their two reviews, kept cc-04's card and review, XP and learning days (${JSON.stringify(afterReset)})`);
    const deleted = await deleteAllLessonProgress({ userId: id });
    const afterAll = { cards: await n('review_cards'), log: await n('review_log'), kept: await kept(), gens: await count(pool, 'SELECT count(*) AS n FROM lesson_progress_lesson_resets WHERE user_id = $1', [id]) };
    check('P7', !('error_type' in deleted) && afterAll.cards === null && afterAll.log === null && afterAll.kept === before && afterAll.gens === 1,
        `delete-all deleted every card and review; XP, learning days and the lesson generation stay (${JSON.stringify(afterAll)})`);
}

/** @param {pg.Pool} pool */
async function p8(pool) {
    const gradeArgs = (/** @type {string} */ id) => ({ userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: 'card-frontend', rating: 'good', source: 'web' });
    const left = async (/** @type {string} */ id) => count(pool, 'SELECT (SELECT count(*) FROM review_cards WHERE user_id = $1) + (SELECT count(*) FROM review_log WHERE user_id = $1) + (SELECT count(*) FROM auth.users WHERE id = $1) AS n', [id]);
    for (const order of ['grade first', 'deletion first']) {
        const inst = instrument(pool);
        const id = await stub(pool, `p8g${order[0]}`);
        await seedPrior(pool, id, COURSE, LESSON, 'card-frontend');
        await seedPrior(pool, id, COURSE, LESSON, 'card-api');
        const del = await pool.connect();
        let outcome = '';
        try {
            if (order === 'grade first') {
                const hold = inst.holdBefore((text) => text === 'commit');
                const gradeP = gradeReviewCard(gradeArgs(id));
                await hold.reached;
                await del.query('BEGIN');
                await del.query(DELETION_SQL.lock, [id]);
                await del.query(DELETION_SQL.lockStub, [id]);
                const t0 = Date.now();
                const delP = del.query(DELETION_SQL.deleteStub, [id]).then(() => Date.now() - t0);
                await sleep(HOLD_MS - LEAD_MS);
                hold.release();
                const grade = /** @type {any} */ (await gradeP);
                const waited = await delP;
                await del.query('COMMIT');
                outcome = `grade ${grade.error_type ?? 'recorded'}, the deletion waited ${waited} ms for the card row`;
                if (waited < BLOCKED_MS) outcome += ' (did not wait)';
            } else {
                await del.query('BEGIN');
                await del.query(DELETION_SQL.lock, [id]);
                await del.query(DELETION_SQL.lockStub, [id]);
                const grade = /** @type {any} */ (await gradeReviewCard(gradeArgs(id)));
                await del.query(DELETION_SQL.deleteStub, [id]);
                await del.query('COMMIT');
                outcome = `grade ${grade.error_type ?? 'recorded'} (it needs no stub lock), then the deletion`;
            }
        } catch (error) {
            outcome = `failed ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`;
            await del.query('ROLLBACK').catch(() => {});
        } finally {
            del.release();
        }
        const rest = await left(id);
        check('P8', !outcome.startsWith('failed') && !outcome.includes('did not wait') && !inst.state.errors.includes('40P01') && rest === 0,
            `${order}: ${outcome}; no 40P01; card rows, log rows and stub left: ${rest}`);
    }
    for (const order of ['entry first', 'deletion first']) {
        const inst = instrument(pool);
        const id = await stub(pool, `p8e${order[0]}`);
        await save(id, LESSON, finished());
        const del = await pool.connect();
        let outcome = '';
        try {
            if (order === 'entry first') {
                const hold = inst.holdBefore((text) => text === 'commit');
                const readP = getReviewQueue({ userId: id });
                await hold.reached;
                await del.query('BEGIN');
                await del.query(DELETION_SQL.lock, [id]);
                const t0 = Date.now();
                const stubP = del.query(DELETION_SQL.lockStub, [id]).then(() => Date.now() - t0);
                await sleep(HOLD_MS - LEAD_MS);
                hold.release();
                const read = /** @type {any} */ (await readP);
                const waited = await stubP;
                await del.query(DELETION_SQL.deleteStub, [id]);
                await del.query('COMMIT');
                outcome = `entry ${read.error_type ?? `${read.inQueue} cards`}, the deletion's stub lock waited ${waited} ms`;
                if (waited < BLOCKED_MS) outcome += ' (did not wait)';
            } else {
                await del.query('BEGIN');
                await del.query(DELETION_SQL.lock, [id]);
                await del.query(DELETION_SQL.lockStub, [id]);
                const t0 = Date.now();
                const readP = quietly(() => getReviewQueue({ userId: id })).then((r) => ({ r: /** @type {any} */ (r), waited: Date.now() - t0 }));
                await sleep(HOLD_MS - LEAD_MS);
                await del.query(DELETION_SQL.deleteStub, [id]);
                await del.query('COMMIT');
                const { r, waited } = await readP;
                outcome = `the entry waited ${waited} ms at the stub, then ${r.error_type ?? 'entered'} (${inst.state.errors.join(',')})`;
                if (waited < BLOCKED_MS || r.error_type !== 'unknown' || !inst.state.errors.includes('23503')) outcome += ' (unexpected)';
            }
        } catch (error) {
            outcome = `failed ${/** @type {any} */ (error).code} ${/** @type {Error} */ (error).message}`;
            await del.query('ROLLBACK').catch(() => {});
        } finally {
            del.release();
        }
        const rest = await left(id);
        check('P8', !outcome.startsWith('failed') && !/did not wait|unexpected/.test(outcome) && !inst.state.errors.includes('40P01') && rest === 0,
            `${order}: ${outcome}; no 40P01; left: ${rest}`);
    }
    // Control: a log table with a second FK, to auth.users. The grade holds its card row; the
    // deletion holds the stub and waits for the card row (cascade); the log insert's FK check then
    // waits for the stub: 40P01.
    {
        await pool.query(`CREATE TABLE IF NOT EXISTS verify_p6_review_log_ctl (LIKE review_log INCLUDING DEFAULTS,
            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id, course_slug, lesson_id, card_id) REFERENCES review_cards (user_id, course_slug, lesson_id, card_id) ON DELETE CASCADE)`);
        const id = await stub(pool, 'p8c');
        await seedPrior(pool, id, COURSE, LESSON, 'card-frontend');
        const g = await pool.connect();
        const d = await pool.connect();
        const codes = [];
        try {
            await g.query('BEGIN');
            await g.query(LEARNER_LOCK_SQL, [id]);
            await g.query("SELECT 1 FROM review_cards WHERE user_id = $1 AND card_id = 'card-frontend' FOR UPDATE", [id]);
            await g.query("UPDATE review_cards SET reps = reps + 1, last_rating = 3, last_review_day = (now() AT TIME ZONE 'Asia/Tokyo')::date, due_day = (now() AT TIME ZONE 'Asia/Tokyo')::date + 11 WHERE user_id = $1 AND card_id = 'card-frontend'", [id]);
            await d.query('BEGIN');
            await d.query(DELETION_SQL.lock, [id]);
            await d.query(DELETION_SQL.lockStub, [id]);
            const delP = codeOf(d.query(DELETION_SQL.deleteStub, [id]));
            await sleep(LEAD_MS);
            codes.push(`log ${await codeOf(g.query("INSERT INTO verify_p6_review_log_ctl (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source) VALUES ($1, $2, $3, 'card-frontend', 3, 3, 11, 10.9, 2.1, 'web')", [id, COURSE, LESSON]))}`);
            codes.push(`deletion ${await delP}`);
        } catch (error) {
            codes.push(`failed ${/** @type {any} */ (error).code}`);
        } finally {
            await g.query('ROLLBACK').catch(() => {});
            await d.query('ROLLBACK').catch(() => {});
            g.release();
            d.release();
        }
        await pool.query('DROP TABLE IF EXISTS verify_p6_review_log_ctl');
        check('P8', codes.some((c) => c.endsWith('40P01')), `control, a log with a foreign key to auth.users: ${codes.join(', ')} (why review_log's only FK is its card row)`);
    }
}

/** @param {pg.Pool} pool */
async function p9(pool) {
    const inst = instrument(pool);
    const id = await stub(pool, 'p9');
    await seedPrior(pool, id, COURSE, LESSON, 'card-frontend');
    const graded = /** @type {any} */ (await gradeReviewCard({ userId: id, courseSlug: COURSE, lessonId: LESSON, cardId: 'card-frontend', rating: 'good', source: 'mcp' }));
    const afterMcp = await count(pool, 'SELECT count(*) AS n FROM learning_days WHERE user_id = $1', [id]);
    const today = await todayOf(pool);
    const reviewDay = String((await pool.query("SELECT string_agg(to_char(review_day, 'YYYY-MM-DD'), ',') AS s FROM review_log WHERE user_id = $1", [id])).rows[0].s);
    const gradeDay = graded.summary?.today;
    const noted = await noteReviewDay({ userId: id.toUpperCase(), day: gradeDay });
    const daysOf = async () => (await pool.query("SELECT string_agg(to_char(day, 'YYYY-MM-DD'), ',' ORDER BY day) AS s FROM learning_days WHERE user_id = $1", [id])).rows[0].s;
    const days = await daysOf();
    check('P9', !graded.error_type && afterMcp === 0 && gradeDay === reviewDay && reviewDay === today && noted === true && days === today,
        `an MCP grade wrote no learning day (${afterMcp}); noteReviewDay with the grade's day (summary.today ${gradeDay} = review_day ${reviewDay}) wrote it (${days}; server today ${today})`);
    const yesterday = String((await pool.query("SELECT to_char((now() AT TIME ZONE 'Asia/Tokyo')::date - 1, 'YYYY-MM-DD') AS d")).rows[0].d);
    const notedYesterday = await noteReviewDay({ userId: id, day: yesterday });
    const bad = await noteReviewDay({ userId: id, day: '2026-02-30' });
    const days2 = await daysOf();
    check('P9', notedYesterday === true && bad === false && days2 === `${yesterday},${today}`,
        `the day as given, not the hook's today: yesterday ${notedYesterday} (a grade just before 00:00 JST, its hook after), not a day ${bad}; learning days ${days2}`);
    await pool.query('DELETE FROM auth.users WHERE id = $1', [id]);
    const before = inst.state.errors.length;
    let threw = false;
    let late = null;
    try {
        late = await quietly(() => noteReviewDay({ userId: id, day: today }));
    } catch {
        threw = true;
    }
    check('P9', !threw && late === false && inst.state.errors.slice(before).join() === '23503', `after the account is deleted: noteReviewDay ${late} (${inst.state.errors.slice(before).join()}, logged), never throws`);
}

/** @param {pg.Pool} pool */
async function p10(pool) {
    const inst = instrument(pool);
    const phase5 = new Set([norm(DELETE_ALL_REVIEW_CARDS_SQL), norm(DELETE_LESSON_REVIEW_CARDS_SQL)]);
    /** Runs fn as the Phase 5 api would: the shipped functions without the review deletes. @template T @param {() => Promise<T>} fn */
    const asPhase5 = async (fn) => {
        inst.state.skip = (text) => phase5.has(text);
        try {
            return await fn();
        } finally {
            inst.state.skip = null;
        }
    };
    /** A learner with cards and one review in the log. @param {string} tag */
    const learner = async (tag) => {
        const id = await learnerWithCards(pool, tag);
        await pool.query("INSERT INTO review_log (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source) VALUES ($1, $2, $3, 'card-frontend', 3, 2, 11, 10.9, 2.1, 'web')", [id, COURSE, LESSON]);
        return id;
    };
    // Left behind by the Phase 5 api.
    const a = await learner('p10a');
    await asPhase5(() => deleteAllLessonProgress({ userId: a }));
    const b = await learner('p10b');
    const bDel = /** @type {any} */ (await asPhase5(() => deleteAllLessonProgress({ userId: b })));
    await save(b, LESSON, finished(), { epoch: bDel.epoch });
    const c = await learner('p10c');
    await asPhase5(() => deleteAllLessonProgress({ userId: c }));
    const quiz = /** @type {any} */ (await applyQuizCheck({ userId: c, courseSlug: COURSE, lessonId: LESSON, questionId: 'q1', choices: ['1'] }));
    const d = await learner('p10d');
    await asPhase5(() => resetLessonProgress({ userId: d, epoch: null, courseSlug: COURSE, lessonId: LESSON }));
    const e = await learner('p10e');
    const eReset = /** @type {any} */ (await asPhase5(() => resetLessonProgress({ userId: e, epoch: null, courseSlug: COURSE, lessonId: LESSON })));
    await save(e, LESSON, finished(), { lessonEpoch: eReset.lessonEpoch });
    const rows = async (/** @type {string} */ id) => count(pool, 'SELECT count(*) AS n FROM review_cards WHERE user_id = $1', [id]);
    const leftBehind = await Promise.all([a, b, c, d, e].map(rows));
    const back = await count(pool, 'SELECT count(*) AS n FROM lesson_progress WHERE user_id = ANY($1)', [[b, c, e]]);
    check('P10', leftBehind.every((n) => n === 5) && back === 3 && !quiz.error_type,
        `the Phase 5 api's delete-all (a), delete-all then a REST save (b), then an MCP course-quiz-check (c), a reset (d), a reset then the lesson finished again (e) each left 5 review cards (${leftBehind.join(', ')}); b, c, e have their lesson row again (${back})`);
    // Controls: entered after a Phase 6 delete-all, a Phase 6 reset, a re-opened account.
    const f = await learner('p10f');
    const fDel = /** @type {any} */ (await deleteAllLessonProgress({ userId: f }));
    await save(f, LESSON, finished(), { epoch: fDel.epoch });
    await getReviewQueue({ userId: f });
    const g = await learner('p10g');
    const gReset = /** @type {any} */ (await resetLessonProgress({ userId: g, epoch: null, courseSlug: COURSE, lessonId: LESSON }));
    await save(g, LESSON, finished(), { lessonEpoch: gReset.lessonEpoch });
    await getReviewQueue({ userId: g });
    const h = await learner('p10h');
    {
        const del = await pool.connect();
        try {
            await del.query('BEGIN');
            await del.query(DELETION_SQL.lock, [h]);
            await del.query(DELETION_SQL.lockStub, [h]);
            await del.query(DELETION_SQL.writeTombstone, [h, 'self']);
            await del.query(DELETION_SQL.deleteStub, [h]);
            await del.query('COMMIT');
        } finally {
            del.release();
        }
        await pool.query("UPDATE account_deletions SET deleted_at = deleted_at - interval '1 hour' WHERE user_id = $1", [h]);
        const reopened = await reopenAccount(pool, h, Date.now() / 1000);
        if (!reopened) throw new Error('P10: the account did not re-open');
        const epoch = String((await pool.query('SELECT epoch FROM lesson_progress_resets WHERE user_id = $1', [h])).rows[0].epoch);
        await save(h, LESSON, finished(), { epoch });
        await getReviewQueue({ userId: h });
    }
    const controls = await Promise.all([f, g, h].map(rows));
    const label = new Map([[a, 'a'], [b, 'b'], [c, 'c'], [d, 'd'], [e, 'e'], [f, 'f'], [g, 'g'], [h, 'h']]);
    const name = (/** @type {string} */ id) => label.get(id) ?? `other ${id.slice(0, 8)}`;
    const listedAccount = (await pool.query(ROLL_FORWARD.listAccount)).rows.map((r) => `${name(r.user_id)}:${r.cards}`).sort();
    const listedLessons = (await pool.query(ROLL_FORWARD.listLessons)).rows.map((r) => `${name(r.user_id)} ${r.course_slug}/${r.lesson_id}:${r.cards}`).sort();
    check('P10', listedAccount.join(',') === 'a:5,b:5,c:5' && listedLessons.join(',') === 'd vibe-coding/vibe-ch1:5,e vibe-coding/vibe-ch1:5' && controls.every((n) => n === 5),
        `the listings over the whole database find exactly a, b, c (${listedAccount.join(', ')}) and d, e (${listedLessons.join(', ')}); the controls f, g, h hold their ${controls.join(', ')} cards`);
    const logBefore = await count(pool, 'SELECT count(*) AS n FROM review_log WHERE user_id = ANY($1)', [[a, b, c, d, e]]);
    const repairedAccount = (await pool.query(ROLL_FORWARD.repairAccount)).rowCount;
    const repairedLessons = (await pool.query(ROLL_FORWARD.repairLessons)).rowCount;
    const after = await Promise.all([a, b, c, d, e, f, g, h].map(rows));
    const logAfter = await count(pool, 'SELECT count(*) AS n FROM review_log WHERE user_id = ANY($1)', [[a, b, c, d, e]]);
    const controlLog = await count(pool, 'SELECT count(*) AS n FROM review_log WHERE user_id = ANY($1)', [[f, g, h]]);
    check('P10', repairedAccount === 15 && repairedLessons === 10 && after.join(',') === '0,0,0,0,0,5,5,5' && logBefore === 5 && logAfter === 0 && controlLog === 0,
        `the repairs deleted ${repairedAccount} + ${repairedLessons} cards and, by cascade, their ${logBefore} reviews; cards left per learner a–h: ${after.join(', ')}`);
    // The next review read after the repair enters the cards of e's finished lesson fresh.
    const fresh = /** @type {any} */ (await getReviewQueue({ userId: e }));
    check('P10', fresh.inQueue === 5, `after the repair, e's next review read enters its finished lesson's cards fresh (${fresh.inQueue})`);
}

/** @param {pg.Pool} pool */
async function p11(pool) {
    const snapshot = async () => JSON.stringify((await pool.query(`SELECT
        (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM review_cards t) AS cards,
        (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM review_log t) AS log,
        (SELECT md5(coalesce(string_agg(user_id::text || course_slug || lesson_id || coalesce(progress_changed_at::text, 'null'), '|' ORDER BY 1), '')) FROM lesson_progress) AS changed,
        (SELECT count(*) FROM review_cards) AS n`)).rows[0]);
    const before = await snapshot();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-verify-p6-'));
    await fs.mkdir(path.join(dir, 'public', 'uploads'), { recursive: true });
    const logger = { log: () => {}, warn: () => {}, error: () => {} };
    let result;
    try {
        result = await runRetention({ pool: /** @type {any} */ (pool), config: readRetentionConfig({}), logger: /** @type {any} */ (logger), uploadRoot: dir });
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
    const after = await snapshot();
    check('P11', result.ran === true && after === before && JSON.parse(before).n > 0, `the retention run (ran ${result.ran}) left review_cards (${JSON.parse(before).n} rows), review_log and progress_changed_at as they were`);
}

/** @param {pg.Pool} pool */
async function p12(pool) {
    instrument(pool);
    const id = await stub(pool, 'p12');
    const today = await todayOf(pool);
    const cards = cardIds('claude-code', 'cc-01-first-session');
    // Priors learned n days back (n = 1..4) and reviews k days back (k = 0..2), as the server stores them.
    for (let n = 1; n <= 4; n += 1) await seedPrior(pool, id, 'claude-code', 'cc-01-first-session', cards[n - 1], n);
    for (let k = 0; k <= 2; k += 1) {
        await pool.query(`INSERT INTO review_cards (user_id, course_slug, lesson_id, card_id, learned_at, prior_rating, stability, difficulty, reps, last_rating, last_review_day, due_day)
            VALUES ($1, 'claude-code', 'cc-01-first-session', $2, now() - interval '20 days', 3, 5, 3, 1, 3, (now() AT TIME ZONE 'Asia/Tokyo')::date - $3::int, (now() AT TIME ZONE 'Asia/Tokyo')::date - $3::int + 2)`, [id, cards[4 + k], k]);
    }
    const rows = (await pool.query(REVIEW_ROWS_SQL, [id])).rows;
    const byCard = new Map(rows.map((r) => [r.card_id, r]));
    /** @type {string[]} */
    const wrong = [];
    for (let n = 1; n <= 4; n += 1) {
        const r = byCard.get(cards[n - 1]);
        const want = { due_on: addDays(today, 2 - n), days_since: n, due: n >= 2, reviewed_today: false };
        for (const [k, v] of Object.entries(want)) if (r?.[k] !== v) wrong.push(`prior ${n} ${k}=${r?.[k]} (want ${v})`);
    }
    for (let k = 0; k <= 2; k += 1) {
        const r = byCard.get(cards[4 + k]);
        const want = { due_on: addDays(today, 2 - k), days_since: k, due: k >= 2, reviewed_today: k === 0 };
        for (const [key, v] of Object.entries(want)) if (r?.[key] !== v) wrong.push(`review ${k} ${key}=${r?.[key]} (want ${v})`);
    }
    check('P12', wrong.length === 0, wrong.length ? wrong.join('; ') : `${rows.length} rows: due_on, days_since, due and reviewed_today from SQL are the Japan-time values for today ${today} − n`);
    const graded = /** @type {any} */ (await gradeReviewCard({ userId: id, courseSlug: 'claude-code', lessonId: 'cc-01-first-session', cardId: cards[2], rating: 'good', source: 'web' }));
    const after = (await pool.query("SELECT to_char(due_day, 'YYYY-MM-DD') AS due, to_char(last_review_day, 'YYYY-MM-DD') AS last FROM review_cards WHERE user_id = $1 AND card_id = $2", [id, cards[2]])).rows[0];
    const log = (await pool.query('SELECT elapsed_days, interval_days FROM review_log WHERE user_id = $1', [id])).rows[0];
    check('P12', !graded.error_type && after.last === today && after.due === addDays(today, graded.graded.intervalDays) && graded.graded.dueOn === after.due && log.elapsed_days === 3 && log.interval_days === graded.graded.intervalDays,
        `a grade of the prior learned 3 days ago: last_review_day ${after.last}, due ${after.due} = today + ${graded.graded.intervalDays}, log elapsed_days ${log.elapsed_days}`);
    const direct = await pool.query(GRADE_REVIEW_CARD_SQL, [id, 'claude-code', 'cc-01-first-session', cards[2], 5, 5, 0, 3, 5]);
    check('P12', direct.rowCount === 0, `the grade statement alone refuses a second review the same day (${direct.rowCount} rows)`);
}

export async function main(argv = process.argv.slice(2)) {
    const { url, allowSkip, help } = parseArgs(argv);
    if (help || !url) {
        console.log('Usage: node scripts/db/verify-phase6.mjs --url postgres://<user>@<host>:<port>/<empty throwaway database> [--allow-skip]');
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
        console.log(`# verify-phase6: database ${target.db}, PostgreSQL ${target.version}`);
        const files = await migrationFiles();
        const before = files.filter((file) => file < FILE);
        for (const file of before) await applyMigration(pool, file);
        // A learner whose lesson row is written before 020 (progress_changed_at NULL afterwards).
        const preId = uid('p1pre');
        await pool.query('INSERT INTO auth.users (id) VALUES ($1)', [preId]);
        await pool.query(`INSERT INTO lesson_progress (user_id, course_slug, lesson_id, progress, state, progress_updated_at, updated_at)
            VALUES ($1, '${COURSE}', '${LESSON}', '{}', 'read', now(), now() - interval '2 days')`, [preId]);
        // 020 in the chain right after 019 (later migrations may follow it; the runs below apply them too).
        check('P1', files.includes(FILE) && /^019_/.test(before.at(-1) ?? ''), `applied ${before.length} migrations (${before[0]} … ${before.at(-1)}) before ${FILE}`);
        await p1Before020(pool, preId);
        await p1Order(pool);
        for (const run of [1, 2]) {
            for (const file of files) await applyMigration(pool, file);
            check('P1', true, `run ${run}: applied ${files.length} migrations (${files[0]} … ${files.at(-1)}), each in its own transaction`);
        }
        await p1(pool, preId);
        await p2(pool);
        await p3(pool);
        roleRan = true;
        await p4(pool, url);
        await p5(pool);
        await p6(pool);
        await p7(pool);
        await p8(pool);
        await p9(pool);
        await p10(pool);
        await p11(pool);
        await p12(pool);
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
