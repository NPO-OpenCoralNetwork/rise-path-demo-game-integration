// Migration 023 (job training: recounts of study time, D12), pinned on its SQL text (npm test has no
// database). The behaviour on PostgreSQL 16 (re-runs, the CHECK both ways, the composite foreign key,
// the immutable records, the deletion's marks on recount rows) is proved by
// scripts/db/verify-training.mjs (T17), which CI's Database checks job runs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DRY_RUN_TABLES } from '../../scripts/delete-account-data.mjs';

const DIR = new URL('../migrations/', import.meta.url);
const FILE = '023_training_study_time_recounts.sql';
/** SQL text without comments (whole-line and trailing ` -- …`), on one line, lower case. */
const flatten = (text) => text.split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .map((line) => line.replace(/\s--\s.*$/, ''))
    .join('\n').replace(/\s+/g, ' ').toLowerCase();
const sql = fs.readFileSync(new URL(FILE, DIR), 'utf8');
const lower = flatten(sql);
const migrations = fs.readdirSync(DIR).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe(`migration ${FILE}`, () => {
    it('is the one 023 migration, right after 022, in the README chain (verify script, before the services, no role SQL, the lock it takes) and the guide', () => {
        assert.equal(migrations.filter((name) => name.startsWith('023_')).length, 1, 'one 023 migration');
        assert.equal(migrations[migrations.indexOf(FILE) - 1]?.slice(0, 4), '022_', 'right after 022');
        const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
        const row = readme.split('\n').find((line) => line.startsWith(`| \`${FILE}\` |`));
        assert.ok(row, 'README row');
        assert.match(row, /scripts\/db\/verify-training\.mjs/);
        assert.match(row, /api・mcp・mcp-public を起動する前に適用/);
        assert.match(row, /`mcp_remote_role\.sql` の流し直しは不要/);
        assert.match(row, /`TRAINING_ENABLED` のないデプロイでは空のまま/);
        assert.match(row, /`training_time_recomputes`/);
        assert.match(row, /`training_time_days\.recompute_id`/);
        assert.match(row, /`account_busy`/, 'the ALTER makes signals, closes and deletions wait');
        assert.match(readme, /確かめ方の 4 つのスクリプト/);
        const guide = read('doc/guides/risepath_vm_deployment.md');
        assert.ok(guide.split('\n').some((line) => line.startsWith('- **023（')), 'a guide bullet for 023');
    });

    it('statements: one table, its index and immutable trigger; one ALTER that adds a nullable column; the foreign key and the CHECK each in a DO block that tolerates a second run; an index; nothing else', () => {
        const statements = lower.replace(/do \$\$.*?\$\$;/g, 'do-block;').split(';').map((s) => s.trim()).filter(Boolean);
        assert.deepEqual(statements.map((s) => s.split(' ').slice(0, 3).join(' ')), [
            'create table if', 'create index if', 'do-block', 'alter table training_time_days', 'do-block', 'do-block', 'create index if',
        ]);
        for (const s of statements) assert.doesNotMatch(s, /^(insert|update|delete|grant|revoke|begin|commit)\b/, s.slice(0, 60));
        assert.doesNotMatch(lower, /\bgrant\b|\brevoke\b|row level security|policy|create (or replace )?function|concurrently|security definer|auth\.users|on delete/);
        assert.doesNotMatch(sql, /risepath_mcp_remote/, 'not even in a comment');
        assert.equal((lower.match(/create (unique )?(table|index) (?!if not exists)/g) || []).length, 0, 'IF NOT EXISTS: re-runnable');
        assert.ok(lower.includes('alter table training_time_days add column if not exists recompute_id bigint null;'), 'a nullable column (R6 seeds day rows with a column list)');
        assert.equal((lower.match(/alter table/g) || []).length, 3, 'the column, then the two constraints in DO blocks');
        assert.ok(lower.indexOf('create table if not exists training_time_recomputes') < lower.indexOf('alter table training_time_days add column'), 'the table before the column that references it');
        assert.ok(lower.includes('do $$ begin create trigger training_time_recomputes_immutable before update or delete on training_time_recomputes for each row execute function public.rp_rows_immutable(); exception when duplicate_object then null; end $$;'));
        assert.ok(lower.includes('do $$ begin alter table training_time_days add constraint training_time_days_recompute_fkey foreign key (recompute_id, cohort_id) references training_time_recomputes (id, cohort_id); exception when duplicate_object then null; end $$;'));
        assert.ok(lower.includes("do $$ begin alter table training_time_days add constraint training_time_days_recompute_check check ((kind = 'recompute') = (recompute_id is not null)); exception when duplicate_object then null; end $$;"));
        assert.ok(lower.includes('create index if not exists training_time_days_recompute_idx on training_time_days (recompute_id) where recompute_id is not null'));
        assert.ok(lower.includes('create index if not exists training_time_recomputes_cohort_idx on training_time_recomputes (cohort_id, id)'));
    });

    it('the record of a recount: the cohort, the days, the overriding versions (at least one), the plan\'s sha256, who and why; no account id and no learner\'s value', () => {
        const body = /create table if not exists training_time_recomputes \((.*?)\);/.exec(lower)?.[1] ?? '';
        assert.match(body, /cohort_id uuid not null references training_cohorts\(id\), from_day date not null, to_day date not null,/);
        assert.match(body, /rule_set_id bigint null references training_time_rule_sets\(id\), catalog_version_id bigint null references training_catalog_versions\(id\),/);
        assert.match(body, /plan_sha256 text not null check \(plan_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\), recomputed_at timestamptz not null default clock_timestamp\(\),/);
        assert.match(body, /recomputed_by text not null check \(length\(recomputed_by\) between 1 and 100\), reason text not null check \(length\(reason\) between 1 and 500\),/);
        assert.match(body, /check \(from_day <= to_day\), check \(rule_set_id is not null or catalog_version_id is not null\), unique \(id, cohort_id\) $/);
        assert.doesNotMatch(body, /user_id|account|counted|over_cap|learners|days_changed|signals/, 'no account id and no learner\'s value: an immutable row a deletion could not mark');
        assert.ok(!DRY_RUN_TABLES.includes('training_time_recomputes'), 'no user_id: the dry run would fail with 42703');
    });

    it('the PostgreSQL proofs apply it: verify-training names the file', () => {
        assert.match(read('scripts/db/verify-training.mjs'), new RegExp(`const FILE_023 = '${FILE}'`));
    });
});
