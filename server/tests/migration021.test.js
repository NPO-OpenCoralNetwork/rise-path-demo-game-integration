// Migration 021 (job training: cohorts and memberships), pinned on its SQL text (npm test has no
// database). The behaviour on PostgreSQL 16 (the deletion mark, a re-opened id added again) is
// proved by scripts/db/verify-account-deletion.mjs R6, which CI's Database checks job runs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COHORT_SLUG, TRAINING_ROLES, TRAINING_SQL } from '../../tools/core/training.js';
import { SQL as DELETION_SQL } from '../services/accountDeletion.js';
import { DRY_RUN_TABLES } from '../../scripts/delete-account-data.mjs';

const DIR = new URL('../migrations/', import.meta.url);
const FILE = '021_training_cohorts.sql';
const TABLES = ['training_cohorts', 'training_memberships'];
/** SQL text without comments (whole-line and trailing ` -- …`), on one line, lower case. */
const flatten = (text) => text.split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .map((line) => line.replace(/\s--\s.*$/, ''))
    .join('\n').replace(/\s+/g, ' ').toLowerCase();
const sql = fs.readFileSync(new URL(FILE, DIR), 'utf8');
const lower = flatten(sql);
const migrations = fs.readdirSync(DIR).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
const statements = lower.split(';').map((s) => s.trim()).filter(Boolean);

/** `CREATE TABLE … ( … );` bodies by table name. */
function tableBodies(text) {
    const bodies = new Map();
    for (const [, name, body] of flatten(text).matchAll(/create table if not exists ([a-z_.]+) \((.*?)\);/g)) bodies.set(name, body);
    return bodies;
}
const bodies = tableBodies(sql);

describe(`migration ${FILE}`, () => {
    it('is the one 021 migration, right after 020, listed in the README chain: verify script, apply before the services, no role SQL to re-run, the deployment guide note', () => {
        assert.equal(migrations.filter((name) => name.startsWith('021_')).length, 1, 'one 021 migration');
        assert.equal(migrations[migrations.indexOf(FILE) - 1]?.slice(0, 4), '020_', 'right after 020');
        const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
        const row = readme.split('\n').find((line) => line.startsWith(`| \`${FILE}\` |`));
        assert.ok(row, 'README row');
        assert.match(row, /scripts\/db\/verify-account-deletion\.mjs/);
        assert.match(row, /api・mcp・mcp-public を起動する前に適用/);
        assert.match(row, /42P01 で取り消されて `deletion_unavailable`/, 'an account deletion needs the table (markTrainingMemberships)');
        assert.match(row, /`mcp_remote_role\.sql` の流し直しは不要/);
        assert.match(row, /`TRAINING_ENABLED` のないデプロイでは空のまま/);
        for (const table of TABLES) assert.ok(row.includes(`\`${table}\``), table);
        const guide = fs.readFileSync(new URL('../../doc/guides/risepath_vm_deployment.md', import.meta.url), 'utf8');
        const note = guide.split('\n').find((line) => line.startsWith('- **021（職業訓練の期と割り当て）**'));
        assert.ok(note, 'the 021 bullet in doc/guides/risepath_vm_deployment.md');
        for (const want of ['起動する前に', '`deletion_unavailable`', '`sql/mcp_remote_role.sql` は流し直さなくてよい', '`TRAINING_ENABLED=true`']) assert.ok(note.includes(want), want);
    });

    it('statements: two tables, three indexes; no data write, ALTER, grant, role name, transaction control, row level security, trigger, function or CONCURRENTLY; re-runnable', () => {
        const kinds = statements.map((s) => s.split(' ').slice(0, 3).join(' '));
        assert.deepEqual(kinds, ['create table if', 'create table if', 'create unique index', 'create index if', 'create index if']);
        assert.deepEqual([...bodies.keys()], TABLES);
        for (const s of statements) assert.doesNotMatch(s, /^(insert|update|delete|alter|grant|revoke|begin|commit|do)\b/, s.slice(0, 60));
        assert.doesNotMatch(lower, /\bgrant\b|\brevoke\b|row level security|policy|trigger|function|concurrently|security definer/);
        assert.doesNotMatch(sql, /risepath_mcp_remote/, 'not even in a comment');
        assert.equal((lower.match(/create (unique )?(table|index) (?!if not exists)/g) || []).length, 0, 'IF NOT EXISTS: re-runnable');
    });

    it('training_cohorts: no account id; the slug CHECK is COHORT_SLUG (tools/core/training.js); a name; dates in order', () => {
        const body = bodies.get('training_cohorts');
        assert.ok(body.startsWith(' id uuid primary key default gen_random_uuid(),'));
        assert.doesNotMatch(body, /user_id|references/, 'a cohort holds no personal data (and DRY_RUN_TABLES counts by user_id)');
        assert.ok(body.includes(`slug text not null unique check (slug ~ '${COHORT_SLUG.source.toLowerCase()}')`), 'COHORT_SLUG is the CHECK');
        assert.match(body, /name text not null check \(length\(name\) between 1 and 200\)/);
        assert.match(body, /check \(starts_on is null or ends_on is null or ends_on >= starts_on\) $/);
    });

    it('training_memberships: no FK to auth.users (the row stays, marked: D3), the role CHECK is TRAINING_ROLES, the mark never before added_at', () => {
        const body = bodies.get('training_memberships');
        assert.match(body, /cohort_id uuid not null references training_cohorts\(id\), user_id uuid not null, /);
        assert.equal((lower.match(/references/g) || []).length, 1, 'only the cohort');
        assert.doesNotMatch(lower, /auth\.users|on delete/);
        assert.ok(body.includes(`role text not null check (role in (${TRAINING_ROLES.map((r) => `'${r}'`).join(', ')}))`), 'TRAINING_ROLES is the CHECK');
        assert.match(body, /added_at timestamptz not null default now\(\), account_deleted_at timestamptz null,/);
        // The deletion marks with the tombstone time (clock_timestamp() after the exclusive account
        // lock), and members are added under the shared lock, so the mark is never earlier.
        assert.match(body, /check \(account_deleted_at is null or account_deleted_at >= added_at\) $/);
    });

    it('indexes: one live row per cohort and account (the ON CONFLICT target of TRAINING_SQL.addMember), the learner\'s live rows, the staff list', () => {
        assert.ok(lower.includes('create unique index if not exists training_memberships_live_uniq on training_memberships (cohort_id, user_id) where account_deleted_at is null'));
        assert.match(TRAINING_SQL.addMember, /ON CONFLICT \(cohort_id, user_id\) WHERE account_deleted_at IS NULL DO NOTHING/);
        assert.ok(lower.includes('create index if not exists training_memberships_user_idx on training_memberships (user_id) where account_deleted_at is null'));
        assert.ok(lower.includes('create index if not exists training_memberships_cohort_idx on training_memberships (cohort_id, added_at)'));
    });

    it('list drift: the deletion marks the live rows with the tombstone time; the staff dry run counts them; the PostgreSQL proof seeds, marks and re-adds them; the remote role never gets them', () => {
        assert.equal(DELETION_SQL.markTrainingMemberships, 'UPDATE training_memberships SET account_deleted_at = (SELECT deleted_at FROM account_deletions WHERE user_id = $1::uuid) WHERE user_id = $1::uuid AND account_deleted_at IS NULL');
        assert.ok(DRY_RUN_TABLES.includes('training_memberships'));
        assert.ok(!DRY_RUN_TABLES.includes('training_cohorts'), 'no user_id: the dry run would fail with 42703');
        const verify = fs.readFileSync(new URL('../../scripts/db/verify-account-deletion.mjs', import.meta.url), 'utf8');
        const want = /const want = \{([\s\S]*?)\};/.exec(verify)?.[1] ?? '';
        for (const key of ['trainingMarked: 1', 'trainingLive: 0', 'trainingB: 1']) assert.ok(want.includes(key), key);
        for (const table of TABLES) assert.match(verify, new RegExp(`INSERT INTO ${table} \\(`), `R6 seeds ${table}`);
        assert.match(verify, /DELETION_SQL\.markTrainingMemberships/);
        assert.match(verify, /readded/, 'a re-opened id can be added again (the live-only unique index)');
        const checks = fs.readFileSync(new URL('../../scripts/ci/db-checks.sh', import.meta.url), 'utf8');
        for (const table of TABLES) assert.ok(checks.includes(`'${table}'`), `db-checks.sh: ${table} never granted`);
    });
});
