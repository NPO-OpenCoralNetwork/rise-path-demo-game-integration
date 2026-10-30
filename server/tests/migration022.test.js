// Migration 022 (job training: study time records), pinned on its SQL text (npm test has no
// database). The behaviour on PostgreSQL 16 (re-runs, the immutable settings, the day CHECK, closing,
// the deletion's marks and its races) is proved by scripts/db/verify-training.mjs, which CI's
// Database checks job runs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRAINING_KEY } from '../../shared/training/courseManifest.js';
import { STUDY_TIME_ALGORITHM } from '../../shared/training/studyTime.js';
import { SIGNAL_FLAGS, TRAINING_TIME_SQL } from '../../tools/core/trainingTime.js';
import { SQL as DELETION_SQL } from '../services/accountDeletion.js';
import { DRY_RUN_TABLES } from '../../scripts/delete-account-data.mjs';

const DIR = new URL('../migrations/', import.meta.url);
const FILE = '022_training_study_time.sql';
const CONFIG = ['training_catalog_versions', 'training_time_rule_sets', 'training_cohort_time_settings'];
const EVIDENCE = ['training_time_streams', 'training_time_signals'];
const DERIVED = ['training_time_days', 'training_time_unit_days'];
const TABLES = [...CONFIG.slice(0, 3), ...EVIDENCE, ...DERIVED];
/** SQL text without comments (whole-line and trailing ` -- …`), on one line, lower case. */
const flatten = (text) => text.split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .map((line) => line.replace(/\s--\s.*$/, ''))
    .join('\n').replace(/\s+/g, ' ').toLowerCase();
const sql = fs.readFileSync(new URL(FILE, DIR), 'utf8');
const lower = flatten(sql);
const migrations = fs.readdirSync(DIR).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
/** `CREATE TABLE … ( … );` bodies by table name. */
const bodies = new Map([...lower.matchAll(/create table if not exists ([a-z_.]+) \((.*?)\);/g)].map(([, name, body]) => [name, body]));
const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const slugCheck = (column) => `${column} text not null check (${column} ~ '${TRAINING_KEY.source.toLowerCase()}')`;

describe(`migration ${FILE}`, () => {
    it('is the one 022 migration, right after 021, listed in the README chain: verify script, apply before the services, no role SQL to re-run', () => {
        assert.equal(migrations.filter((name) => name.startsWith('022_')).length, 1, 'one 022 migration');
        assert.equal(migrations[migrations.indexOf(FILE) - 1]?.slice(0, 4), '021_', 'right after 021');
        const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
        const row = readme.split('\n').find((line) => line.startsWith(`| \`${FILE}\` |`));
        assert.ok(row, 'README row');
        assert.match(row, /scripts\/db\/verify-training\.mjs/);
        assert.match(row, /api・mcp・mcp-public を起動する前に適用/);
        assert.match(row, /42P01 で取り消されて `deletion_unavailable`/, 'an account deletion needs the tables (the two marks)');
        assert.match(row, /`mcp_remote_role\.sql` の流し直しは不要/);
        assert.match(row, /`TRAINING_ENABLED` のないデプロイでは空のまま/);
        assert.match(row, /`scripts\/training-time\.mjs` で読み込む/);
        for (const table of TABLES) assert.ok(row.includes(`\`${table}\``), table);
        assert.match(readme, /確かめ方の 4 つのスクリプト/);
    });

    it('statements: seven tables, their indexes and the three triggers of the settings; no data write, ALTER, grant, role name, transaction control, row level security, own function or CONCURRENTLY; re-runnable', () => {
        assert.deepEqual([...bodies.keys()], TABLES);
        const statements = lower.replace(/do \$\$.*?\$\$;/g, 'do-block;').split(';').map((s) => s.trim()).filter(Boolean);
        assert.deepEqual(statements.map((s) => s.split(' ').slice(0, 3).join(' ')), [
            'create table if', 'create table if', 'create table if', 'create index if', 'do-block', 'do-block', 'do-block',
            'create table if', 'create unique index', 'create index if', 'create index if', 'create table if',
            'create table if', 'create unique index', 'create index if', 'create index if', 'create table if',
        ]);
        for (const s of statements) assert.doesNotMatch(s, /^(insert|update|delete|alter|grant|revoke|begin|commit)\b/, s.slice(0, 60));
        assert.doesNotMatch(lower, /\bgrant\b|\brevoke\b|row level security|policy|create (or replace )?function|concurrently|security definer|auth\.users|on delete/);
        assert.doesNotMatch(sql, /risepath_mcp_remote/, 'not even in a comment');
        assert.equal((lower.match(/create (unique )?(table|index) (?!if not exists)/g) || []).length, 0, 'IF NOT EXISTS: re-runnable');
        // Each trigger in its own DO block that tolerates a second run (as 018).
        const triggers = [...lower.matchAll(/do \$\$ begin create trigger ([a-z_]+) before update or delete on ([a-z_]+) for each row execute function public\.rp_rows_immutable\(\); exception when duplicate_object then null; end \$\$;/g)];
        assert.deepEqual(triggers.map(([, , table]) => table), CONFIG, 'the settings never change; the evidence and the days do get the deletion\'s mark');
        assert.deepEqual(triggers.map(([, name]) => name), CONFIG.map((t) => `${t}_immutable`));
        assert.equal((lower.match(/create trigger/g) || []).length, 3);
    });

    it('the settings: slugs as TRAINING_KEY, the algorithm as study-time/vN, sha256 names, who and why; a setting never starts before the day it was written (the insert\'s own clock)', () => {
        const catalog = bodies.get('training_catalog_versions');
        assert.ok(catalog.includes(slugCheck('course_key')), 'course_key is a TRAINING_KEY');
        assert.match(catalog, /sha256 text not null unique check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
        assert.match(catalog, /manifest jsonb not null check \(jsonb_typeof\(manifest\) = 'object'\)/);
        const rules = bodies.get('training_time_rule_sets');
        assert.match(rules, /algorithm text not null check \(algorithm ~ '\^study-time\/v\[1-9\]\[0-9\]\{0,2\}\$'\)/);
        assert.match(STUDY_TIME_ALGORITHM, /^study-time\/v[1-9][0-9]{0,2}$/);
        for (const body of [catalog, rules]) {
            assert.match(body, /loaded_by text not null check \(length\(loaded_by\) between 1 and 100\), note text not null check \(length\(note\) between 1 and 500\)/);
            assert.doesNotMatch(body, /user_id/, 'no personal data');
        }
        const settings = bodies.get('training_cohort_time_settings');
        assert.match(settings, /cohort_id uuid not null references training_cohorts\(id\), catalog_version_id bigint not null references training_catalog_versions\(id\), rule_set_id bigint not null references training_time_rule_sets\(id\), effective_from date not null,/);
        assert.match(settings, /set_at timestamptz not null default clock_timestamp\(\),/);
        assert.match(settings, /check \(effective_from >= \(set_at at time zone 'asia\/tokyo'\)::date\) $/);
        assert.doesNotMatch(TRAINING_TIME_SQL.insertSetting, /set_at/, 'the core never sends set_at');
        assert.ok(lower.includes('create index if not exists training_cohort_time_settings_cohort_idx on training_cohort_time_settings (cohort_id, effective_from, id)'));
    });

    it('the evidence: a stream per learner, chain and Japan-time day (live rows unique), a narrow signal row with no account id; flags as SIGNAL_FLAGS', () => {
        const streams = bodies.get('training_time_streams');
        assert.match(streams, /user_id uuid not null, cohort_id uuid not null references training_cohorts\(id\),/);
        assert.ok(streams.includes(slugCheck('unit_key')));
        assert.match(streams, /check \(day = \(started_at at time zone 'asia\/tokyo'\)::date\), check \(chain_started_at <= started_at\), check \(account_deleted_at is null or account_deleted_at >= started_at\) $/);
        assert.ok(lower.includes('create unique index if not exists training_time_streams_live_uniq on training_time_streams (user_id, chain_id, day) where account_deleted_at is null'));
        assert.ok(lower.includes('create index if not exists training_time_streams_learner_idx on training_time_streams (user_id, cohort_id, day)'));
        assert.ok(lower.includes('create index if not exists training_time_streams_cohort_idx on training_time_streams (cohort_id, day)'));
        const signals = bodies.get('training_time_signals');
        assert.equal(signals, ' stream_id bigint not null references training_time_streams(id), received_at timestamptz not null, seq integer not null check (seq >= 0), flags smallint not null check (flags between 0 and 7), primary key (stream_id, seq) ');
        assert.equal(Object.values(SIGNAL_FLAGS).reduce((a, b) => a | b, 0), 7);
    });

    it('the days: one close per learner, cohort and day (live rows; the ON CONFLICT target of the core), recounts added beside it, the current value by an index; unit rows with no account id', () => {
        const days = bodies.get('training_time_days');
        assert.match(days, /kind text not null check \(kind in \('close', 'recompute'\)\),/);
        assert.match(days, /counted_ms integer not null check \(counted_ms between 0 and 86400000\), over_cap_ms integer not null check \(over_cap_ms between 0 and 86400000\),/);
        assert.match(days, /evidence_sha256 text not null check \(evidence_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\), computed_at timestamptz not null default clock_timestamp\(\),/);
        assert.match(days, /check \(counted_ms \+ over_cap_ms <= 86400000\), check \(account_deleted_at is null or account_deleted_at >= computed_at\) $/);
        assert.ok(lower.includes("create unique index if not exists training_time_days_close_uniq on training_time_days (user_id, cohort_id, day) where kind = 'close' and account_deleted_at is null"));
        assert.match(TRAINING_TIME_SQL.insertDays, /ON CONFLICT \(user_id, cohort_id, day\) WHERE kind = 'close' AND account_deleted_at IS NULL DO NOTHING/);
        assert.ok(lower.includes('create index if not exists training_time_days_current_idx on training_time_days (user_id, cohort_id, day, id desc) where account_deleted_at is null'));
        assert.ok(lower.includes('create index if not exists training_time_days_cohort_idx on training_time_days (cohort_id, day)'));
        const units = bodies.get('training_time_unit_days');
        assert.ok(units.includes(slugCheck('unit_key')));
        assert.match(units, /^ day_id bigint not null references training_time_days\(id\),/);
        assert.match(units, /primary key \(day_id, unit_key\), check \(counted_ms > 0 or over_cap_ms > 0\) $/);
        for (const table of ['training_time_signals', 'training_time_unit_days']) assert.doesNotMatch(bodies.get(table), /user_id|account_deleted_at/, `${table}: hidden by its parent's mark`);
    });

    it('list drift: the deletion marks the streams and the days with the tombstone time; the dry run counts them; the PostgreSQL proofs; no training_ table for the remote role', () => {
        for (const [name, table] of [['markTrainingTimeStreams', 'training_time_streams'], ['markTrainingTimeDays', 'training_time_days']]) {
            assert.equal(DELETION_SQL[name], `UPDATE ${table} SET account_deleted_at = (SELECT deleted_at FROM account_deletions WHERE user_id = $1::uuid) WHERE user_id = $1::uuid AND account_deleted_at IS NULL`);
            assert.ok(DRY_RUN_TABLES.includes(table), table);
        }
        for (const table of [...CONFIG, 'training_time_signals', 'training_time_unit_days']) assert.ok(!DRY_RUN_TABLES.includes(table), `${table}: no user_id, the dry run would fail with 42703`);
        const verify = read('scripts/db/verify-account-deletion.mjs');
        const want = /const want = \{([\s\S]*?)\};/.exec(verify)?.[1] ?? '';
        for (const key of ['timeStreamsMarked: 1', 'timeDaysMarked: 1', 'timeLive: 0', 'timeB: 2']) assert.ok(want.includes(key), `R6: ${key}`);
        for (const name of ['markTrainingTimeStreams', 'markTrainingTimeDays']) assert.match(verify, new RegExp(`DELETION_SQL\\.${name}`), `R6 runs the service's ${name}`);
        assert.match(read('scripts/db/verify-training.mjs'), new RegExp(`const FILE = '${FILE}'`));
        // Every training_ table of every migration, none reachable by the remote MCP role.
        const all = migrations.flatMap((name) => [...flatten(fs.readFileSync(new URL(name, DIR), 'utf8')).matchAll(/create table if not exists (training_[a-z_]+) \(/g)].map((m) => m[1]));
        assert.equal(all.length, 9);
        const checks = read('scripts/ci/db-checks.sh');
        assert.ok(checks.includes(`"0 of ${all.length}"`), `db-checks.sh: no privilege on any of the ${all.length} training_ tables`);
    });
});
