// Migration 019 (Phase 5: one-lesson reset, XP ledger, learning days), pinned on its SQL text (npm
// test has no database). The behaviour on PostgreSQL 16 is proved by scripts/db/verify-phase5.mjs,
// which CI's Database checks job runs (scripts/ci/db-checks.sh).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BLENDER_XP_SELECT, LESSON_XP_SELECT } from '../../tools/core/achievements.js';
import { DRY_RUN_TABLES } from '../../scripts/delete-account-data.mjs';

const DIR = new URL('../migrations/', import.meta.url);
const FILE = '019_phase5_learning.sql';
const TABLES = ['lesson_progress_lesson_resets', 'xp_awards', 'learning_days'];
/** SQL text without comments (whole-line and trailing ` -- …`), on one line, lower case. */
const flatten = (text) => text.split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .map((line) => line.replace(/\s--\s.*$/, ''))
    .join('\n').replace(/\s+/g, ' ').toLowerCase();
const sql = fs.readFileSync(new URL(FILE, DIR), 'utf8');
const lower = flatten(sql);
const migrations = fs.readdirSync(DIR).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();

/** `CREATE TABLE … ( … );` bodies by table name. */
function tableBodies(text) {
    const bodies = new Map();
    for (const [, name, body] of flatten(text).matchAll(/create table if not exists ([a-z_.]+) \((.*?)\);/g)) bodies.set(name, body);
    return bodies;
}
const bodies = tableBodies(sql);

describe(`migration ${FILE}`, () => {
    it('is the one 019 migration, listed in the README chain with how to verify it, when to apply it and what to do when an account deletion overlaps it', () => {
        assert.equal(migrations.filter((name) => name.startsWith('019_')).length, 1, 'one 019 migration');
        const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
        const row = readme.split('\n').find((line) => line.startsWith(`| \`${FILE}\` |`));
        assert.ok(row, 'README row');
        assert.match(row, /scripts\/db\/verify-phase5\.mjs/);
        assert.match(row, /流し直しは不要/);
        assert.match(row, /api・mcp・mcp-public を起動する前に適用/);
        assert.match(row, /デッドロック（40P01）[^|]*`npm run db:migrate`[^|]*をもう一度流し/, 'a deletion during the deploy: re-run');
        for (const table of TABLES) assert.ok(row.includes(`\`${table}\``), table);
    });

    it('creates exactly the three tables, each with user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE and no other reference', () => {
        assert.deepEqual([...bodies.keys()], TABLES);
        for (const table of TABLES) {
            assert.ok(bodies.get(table).startsWith(' user_id uuid not null references auth.users(id) on delete cascade,'), table);
        }
        assert.equal((lower.match(/references/g) || []).length, 3, 'no composite FK to lesson_progress: reset rows outlive a delete-all');
        assert.doesNotMatch(lower, /foreign key|alter table/);
    });

    it('primary keys are the idempotency keys; ids follow the one id rule', () => {
        assert.match(bodies.get('lesson_progress_lesson_resets'), /primary key \(user_id, course_slug, lesson_id\) $/);
        assert.match(bodies.get('lesson_progress_lesson_resets'), /lesson_epoch uuid not null default gen_random_uuid\(\), reset_at timestamptz not null default now\(\)/);
        assert.match(bodies.get('xp_awards'), /primary key \(user_id, source, item_key, milestone\)/);
        assert.match(bodies.get('learning_days'), /^ user_id uuid not null references auth\.users\(id\) on delete cascade, day date not null, primary key \(user_id, day\) $/);
        for (const column of ['course_slug', 'lesson_id']) {
            assert.ok(bodies.get('lesson_progress_lesson_resets').includes(`${column} text not null check (${column} ~ '^[a-z0-9][a-z0-9-]{0,79}$')`), column);
        }
        assert.ok(bodies.get('xp_awards').includes("item_key text not null check (item_key ~ '^[a-z0-9][a-z0-9-]{0,79}/[a-z0-9][a-z0-9-]{0,79}$')"));
    });

    it('the amount CHECK: lesson start 10, lesson done 40, Blender stage done 80, nothing else (owner decision O1)', () => {
        const body = bodies.get('xp_awards');
        assert.match(body, /source text not null check \(source in \('lesson', 'blender_stage'\)\)/);
        assert.match(body, /milestone text not null check \(milestone in \('start', 'done'\)\)/);
        assert.match(body, /xp smallint not null/);
        assert.ok(body.includes("constraint xp_awards_amount_check check ( (source = 'lesson' and milestone = 'start' and xp = 10) or (source = 'lesson' and milestone = 'done' and xp = 40) or (source = 'blender_stage' and milestone = 'done' and xp = 80))"), body);
    });

    it('keeps only what it needs: no first time of a day, no event types, no grant, nothing for the remote MCP role', () => {
        assert.doesNotMatch(lower, /first_at/);
        assert.doesNotMatch(lower, /\bgrant\b|\brevoke\b|risepath_mcp_remote|row level security/);
        assert.doesNotMatch(sql, /risepath_mcp_remote/, 'not even in a comment');
        assert.doesNotMatch(lower, /security definer|create trigger|create (or replace )?function/);
    });

    it('re-runnable inside the migrator\'s transaction: IF NOT EXISTS, every INSERT ends ON CONFLICT … DO NOTHING', () => {
        assert.equal((lower.match(/create table (?!if not exists)/g) || []).length, 0);
        assert.doesNotMatch(lower, /concurrently|(^|;) ?(begin|commit);/);
        const inserts = lower.split(';').map((s) => s.trim()).filter((s) => s.startsWith('insert into'));
        assert.equal(inserts.length, 4, 'two award backfills, two day backfills');
        for (const insert of inserts) assert.match(insert, / on conflict \([a-z_, ]+\) do nothing$/, insert);
    });

    it('the award backfills are the runtime rules (tools/core/achievements.js) word for word', () => {
        assert.ok(lower.includes(flatten(LESSON_XP_SELECT)), 'LESSON_XP_SELECT');
        assert.ok(lower.includes(flatten(BLENDER_XP_SELECT)), 'BLENDER_XP_SELECT');
        assert.ok(lower.includes(`insert into xp_awards (user_id, source, item_key, milestone, xp) ${flatten(LESSON_XP_SELECT)} order by 1, 3, 4 on conflict`));
        assert.ok(lower.includes(`insert into xp_awards (user_id, source, item_key, milestone, xp) ${flatten(BLENDER_XP_SELECT)} order by 1, 3 on conflict`));
    });

    it('the day backfill: lesson and stage events (Japan time), each lesson\'s last change capped by the row\'s write time; never diagnosis or course generation', () => {
        assert.ok(lower.includes("insert into learning_days (user_id, day) select distinct user_id, (created_at at time zone 'asia/tokyo')::date from learning_events where type in ('lesson_start', 'lesson_complete', 'stage_complete') on conflict (user_id, day) do nothing"));
        assert.ok(lower.includes("insert into learning_days (user_id, day) select distinct user_id, (least(progress_updated_at, updated_at) at time zone 'asia/tokyo')::date from lesson_progress where state <> 'not_started' and progress_updated_at > to_timestamp(0) on conflict (user_id, day) do nothing"));
        assert.doesNotMatch(lower, /diagnosis_complete|course_generated|course_complete/);
    });

    it('the Blender stages it counts are the course\'s stage ids (data/curricula/blender/courseData.ts)', () => {
        const course = fs.readFileSync(new URL('../../data/curricula/blender/courseData.ts', import.meta.url), 'utf8');
        const ids = [...course.matchAll(/^ {4}id: (\d+),/gm)].map((m) => m[1]);
        assert.deepEqual(ids, ['1', '2', '3', '4']);
        assert.ok(BLENDER_XP_SELECT.includes(`s.stage IN (${ids.map((id) => `'${id}'`).join(', ')})`));
    });

    it('list drift: the staff dry run counts all three tables, and the PostgreSQL proof of account deletion checks they go', () => {
        for (const table of TABLES) assert.ok(DRY_RUN_TABLES.includes(table), `DRY_RUN_TABLES has ${table}`);
        const verify = fs.readFileSync(new URL('../../scripts/db/verify-account-deletion.mjs', import.meta.url), 'utf8');
        const want = /const want = \{([\s\S]*?)\};/.exec(verify)?.[1] ?? '';
        for (const key of ['lessonProgress: 0', 'lessonResets: 0', 'xpAwards: 0', 'learningDays: 0']) assert.ok(want.includes(key), key);
        for (const table of TABLES) assert.match(verify, new RegExp(`INSERT INTO ${table} \\(`), `R6 seeds ${table}`);
    });
});
