// Migration 020 (Phase 6: the review queue), pinned on its SQL text (npm test has no database). The
// behaviour on PostgreSQL 16 is proved by scripts/db/verify-phase6.mjs, which CI's Database checks
// job runs (scripts/ci/db-checks.sh).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARD_ID, REVIEW_SOURCES } from '../../tools/core/reviewQueue.js';
import { AGAIN, GOOD, GRADE_OF, MAX_INTERVAL_DAYS, S_MAX, S_MIN, D_MAX, D_MIN } from '../../shared/review/fsrs.js';
import { DRY_RUN_TABLES } from '../../scripts/delete-account-data.mjs';

const DIR = new URL('../migrations/', import.meta.url);
const FILE = '020_review_queue.sql';
const TABLES = ['review_cards', 'review_log'];
/** SQL text without comments (whole-line and trailing ` -- …`), on one line, lower case. */
const flatten = (text) => text.split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .map((line) => line.replace(/\s--\s.*$/, ''))
    .join('\n').replace(/\s+/g, ' ').toLowerCase();
const sql = fs.readFileSync(new URL(FILE, DIR), 'utf8');
const lower = flatten(sql);
const migrations = fs.readdirSync(DIR).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
/** Top-level statements (the DO and function bodies kept whole: their ; are inside $$ … $$). */
const statements = lower.split(/;(?=(?:[^$]*\$\$[^$]*\$\$)*[^$]*$)/).map((s) => s.trim()).filter(Boolean);

/** `CREATE TABLE … ( … );` bodies by table name. */
function tableBodies(text) {
    const bodies = new Map();
    for (const [, name, body] of flatten(text).matchAll(/create table if not exists ([a-z_.]+) \((.*?)\);/g)) bodies.set(name, body);
    return bodies;
}
const bodies = tableBodies(sql);

describe(`migration ${FILE}`, () => {
    it('is the one 020 migration, listed in the README chain: verify script, apply before the services, re-run the role SQL for BYOA, no deadlock with a deletion (it waits, or answers account_busy after 10 s), the deployment guide note', () => {
        assert.equal(migrations.filter((name) => name.startsWith('020_')).length, 1, 'one 020 migration');
        assert.ok(migrations.includes(FILE), 'in the chain (not necessarily the latest: 021 and later come after it)');
        assert.equal(migrations[migrations.indexOf(FILE) - 1]?.slice(0, 4), '019_', 'right after 019');
        const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
        const row = readme.split('\n').find((line) => line.startsWith(`| \`${FILE}\` |`));
        assert.ok(row, 'README row');
        assert.match(row, /scripts\/db\/verify-phase6\.mjs/);
        assert.match(row, /api・mcp・mcp-public を起動する前に適用/);
        assert.match(row, /BYOA を使っているときは `deploy\/risepath-vm\/sql\/mcp_remote_role\.sql` を流し直す/);
        assert.match(row, /デッドロック（40P01）にはならない/);
        assert.match(row, /10 秒を超えると `account_busy` で終わる/, 'a deletion waits, or answers account_busy (lock_timeout 10 s)');
        assert.match(row, /`auth\.users` をロックするので、ログインした呼び出しも 020 が終わるまで待つ/, 'signed-in requests pause until 020 commits');
        // The VM deployment guide's per-migration note (as for 018 and 019).
        const guide = fs.readFileSync(new URL('../../doc/guides/risepath_vm_deployment.md', import.meta.url), 'utf8');
        const note = guide.split('\n').find((line) => line.startsWith('- **020（Phase 6、復習）**'));
        assert.ok(note, 'the 020 bullet in doc/guides/risepath_vm_deployment.md');
        for (const want of ['`sql/mcp_remote_role.sql` を流し直す', '`account_busy`', '`ROLL_FORWARD`', '起動する前に']) assert.ok(note.includes(want), want);
        assert.match(row, /`lesson_progress\.progress_changed_at`/);
        for (const table of TABLES) assert.ok(row.includes(`\`${table}\``), table);
    });

    it('statements: two tables, one column, one function, one trigger; no data write, grant, transaction control, row level security or CONCURRENTLY', () => {
        const kinds = statements.map((s) => s.split(' ').slice(0, 3).join(' '));
        assert.deepEqual(kinds, ['create table if', 'create table if', 'alter table lesson_progress', 'create or replace', 'do $$ begin']);
        assert.deepEqual([...bodies.keys()], TABLES);
        assert.equal(statements.filter((s) => s.startsWith('alter table')).length, 1);
        assert.ok(statements.includes('alter table lesson_progress add column if not exists progress_changed_at timestamptz null'));
        for (const s of statements) assert.doesNotMatch(s, /^(insert|update|delete|grant|revoke|begin|commit|create index|create unique)\b/, s.slice(0, 60));
        assert.doesNotMatch(lower, /\bgrant\b|\brevoke\b|risepath_mcp_remote|row level security|concurrently|insert into/);
        assert.doesNotMatch(sql, /risepath_mcp_remote/, 'not even in a comment');
        assert.equal((lower.match(/create table (?!if not exists)/g) || []).length, 0, 'IF NOT EXISTS: re-runnable');
    });

    it('order (the 40P01 guard): both tables before the lesson_progress ALTER, so an account deletion in its cascade and this migration never deadlock (one waits for the other)', () => {
        const at = (needle) => lower.indexOf(needle);
        assert.ok(at('create table if not exists review_log') > at('create table if not exists review_cards'));
        assert.ok(at('alter table lesson_progress') > at('create table if not exists review_log'), 'tables (auth.users SHARE ROW EXCLUSIVE) first, then lesson_progress (ACCESS EXCLUSIVE)');
        assert.match(sql, /-- Order: the two tables first, then lesson_progress\./);
    });

    it('the trigger: an INSERT and a progress change set clock_timestamp() (the write\'s time, not the transaction\'s start); any other UPDATE keeps it or freezes updated_at in; BEFORE INSERT OR UPDATE, the 016 duplicate_object pattern', () => {
        const fn = /create or replace function set_lesson_progress_changed_at\(\) returns trigger as \$\$ (.*?) \$\$ language plpgsql/.exec(lower)?.[1];
        // now() would date a write whose transaction began before another write of the row committed
        // earlier than that write; the entry's studied rule would then take finished cards as added later.
        assert.equal(fn, "begin if tg_op = 'insert' then new.progress_changed_at := clock_timestamp(); elsif new.progress is distinct from old.progress then new.progress_changed_at := clock_timestamp(); else new.progress_changed_at := coalesce(old.progress_changed_at, old.updated_at); end if; return new; end;");
        assert.ok(lower.includes('do $$ begin create trigger lesson_progress_changed_at before insert or update on lesson_progress for each row execute function set_lesson_progress_changed_at(); exception when duplicate_object then null; end $$;'));
        assert.doesNotMatch(lower, /security definer/);
    });

    it('review_cards: the key, every CHECK of the design (ids, ratings, memory bounds, prior pairing, both memory branches with 1–365 days), entered_at = clock_timestamp(), user_id CASCADE', () => {
        const body = bodies.get('review_cards');
        assert.ok(body.startsWith(' user_id uuid not null references auth.users(id) on delete cascade,'));
        assert.equal((body.match(/references/g) || []).length, 1);
        assert.match(body, /primary key \(user_id, course_slug, lesson_id, card_id\)/);
        for (const column of ['course_slug', 'lesson_id']) assert.ok(body.includes(`${column} text not null check (${column} ~ '^[a-z0-9][a-z0-9-]{0,79}$')`), column);
        assert.ok(body.includes(`card_id text not null check (card_id ~ '${CARD_ID.source}')`), 'CARD_ID (tools/core/reviewQueue.js) is the CHECK');
        assert.match(body, /entered_at timestamptz not null default clock_timestamp\(\)/, 'not now(): later than any reset that committed before the insert');
        assert.match(body, /learned_at timestamptz null, checked_at timestamptz null, prior_rating smallint null check \(prior_rating in \(1, 3\)\), due_day date not null,/);
        assert.ok(body.includes(`stability double precision null check (stability between ${S_MIN} and ${S_MAX})`));
        assert.ok(body.includes(`difficulty double precision null check (difficulty between ${D_MIN} and ${D_MAX})`));
        assert.match(body, /reps integer not null default 0 check \(reps >= 0\), lapses integer not null default 0,/);
        assert.match(body, /last_rating smallint null check \(last_rating in \(1, 3\)\), last_review_day date null,/);
        assert.match(body, /constraint review_cards_lapses_check check \(lapses between 0 and reps\)/);
        assert.match(body, /constraint review_cards_prior_check check \(\(learned_at is null\) = \(prior_rating is null\)\)/);
        const memory = /constraint review_cards_memory_check check \((.*)\) $/.exec(body)?.[1];
        assert.equal(memory, ' (reps = 0 and last_rating is null and last_review_day is null'
            + ' and ( (learned_at is not null and stability is not null and difficulty is not null'
            + " and due_day > (learned_at at time zone 'asia/tokyo')::date"
            + ` and due_day <= (learned_at at time zone 'asia/tokyo')::date + ${MAX_INTERVAL_DAYS})`
            + ' or (learned_at is null and stability is null and difficulty is null)))'
            + ' or (reps > 0 and stability is not null and difficulty is not null and last_rating is not null and last_review_day is not null'
            + " and (learned_at is null or (learned_at at time zone 'asia/tokyo')::date < last_review_day)"
            + ` and due_day > last_review_day and due_day <= last_review_day + ${MAX_INTERVAL_DAYS})`);
        assert.doesNotMatch(body, /due_day date not null default/, 'the entry computes it');
    });

    it('review_log: one review of a card a Japan-time day (the key), database-stamped day and time, its only FK is its card row (CASCADE, never auth.users: 40P01)', () => {
        const body = bodies.get('review_log');
        assert.ok(body.startsWith(' user_id uuid not null, course_slug text not null, lesson_id text not null, card_id text not null,'));
        assert.match(body, /review_day date not null default \(\(now\(\) at time zone 'asia\/tokyo'\)::date\), reviewed_at timestamptz not null default now\(\),/);
        assert.match(body, /rating smallint not null check \(rating in \(1, 3\)\)/);
        assert.match(body, /elapsed_days integer null check \(elapsed_days >= 1\)/);
        assert.ok(body.includes(`interval_days integer not null check (interval_days between 1 and ${MAX_INTERVAL_DAYS})`));
        assert.ok(body.includes(`stability double precision not null check (stability between ${S_MIN} and ${S_MAX})`));
        assert.ok(body.includes(`difficulty double precision not null check (difficulty between ${D_MIN} and ${D_MAX})`));
        assert.ok(body.includes(`source text not null check (source in (${REVIEW_SOURCES.map((s) => `'${s}'`).join(', ')}))`));
        assert.match(body, /primary key \(user_id, course_slug, lesson_id, card_id, review_day\)/);
        assert.equal((body.match(/references/g) || []).length, 1);
        assert.match(body, /constraint review_log_card_fkey foreign key \(user_id, course_slug, lesson_id, card_id\) references review_cards \(user_id, course_slug, lesson_id, card_id\) on delete cascade $/);
        assert.doesNotMatch(body, /auth\.users/);
        assert.equal((lower.match(/references auth\.users/g) || []).length, 1, 'only review_cards.user_id');
    });

    it('the stored ratings are the two buttons (R3): 1 「もう一度」, 3 「覚えた」', () => {
        assert.deepEqual(Object.values(GRADE_OF), [AGAIN, GOOD]);
        assert.deepEqual([AGAIN, GOOD], [1, 3]);
    });

    it('list drift: the staff dry run counts both tables, and the PostgreSQL proof of account deletion checks they go', () => {
        for (const table of TABLES) assert.ok(DRY_RUN_TABLES.includes(table), `DRY_RUN_TABLES has ${table}`);
        const verify = fs.readFileSync(new URL('../../scripts/db/verify-account-deletion.mjs', import.meta.url), 'utf8');
        const want = /const want = \{([\s\S]*?)\};/.exec(verify)?.[1] ?? '';
        for (const key of ['reviewCards: 0', 'reviewLog: 0']) assert.ok(want.includes(key), key);
        for (const table of TABLES) assert.match(verify, new RegExp(`INSERT INTO ${table} \\(`), `R6 seeds ${table}`);
    });
});
