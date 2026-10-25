// Migration 018 (Phase 4: account deletion, proof of consent, retention), pinned on its SQL text:
// CI has no Postgres. The behaviour on a real PostgreSQL 16 is proved by
// scripts/db/verify-account-deletion.mjs (the stage gate and the README's 確かめ方).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DIR = new URL('../migrations/', import.meta.url);
const FILE = '018_account_deletion_and_legal.sql';
/** SQL text without comments (whole-line and trailing ` -- …`), on one line, lower case. */
const flatten = (text) => text.split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .map((line) => line.replace(/\s--\s.*$/, ''))
    .join('\n').replace(/\s+/g, ' ').toLowerCase();
const sql = fs.readFileSync(new URL(FILE, DIR), 'utf8');
const code = sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
const lower = flatten(sql);
const migrations = fs.readdirSync(DIR).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();

/** `CREATE TABLE … ( … );` bodies of a SQL text by table name (comments stripped). */
function tableBodies(text) {
    const bodies = new Map();
    for (const [, name, body] of flatten(text).matchAll(/create table if not exists ([a-z_.]+) \((.*?)\);/g)) bodies.set(name, body);
    return bodies;
}

/**
 * Every column FK to auth.users in a migration: { table, column, onDelete } (onDelete null when the
 * FK has no ON DELETE clause, i.e. NO ACTION). Fails on any other form of reference, so a
 * table-level FOREIGN KEY or an ALTER TABLE cannot slip past this check.
 */
function authUserFks(name) {
    const text = fs.readFileSync(new URL(name, DIR), 'utf8');
    // 018's re-add is a format() template, not a table definition (checked on its own below).
    const flat = flatten(text).replaceAll("references auth.users(id) on delete %s'", '');
    const total = (flat.match(/references auth\.users/g) || []).length;
    const fks = [];
    for (const [table, body] of tableBodies(text)) {
        for (const column of body.split(/,(?![^(]*\))/)) {
            const m = /^\s*([a-z_]+) uuid\b.*references auth\.users\(id\)(?: on delete (cascade|set null|restrict|no action|set default))?/.exec(column);
            if (m) fks.push({ table, column: m[1], onDelete: m[2] ?? null });
        }
    }
    return { fks, total, name };
}

/** The (table, column, action) list 018 re-adds by catalog lookup. */
const overrides = [...code.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)',\s*'(SET NULL|CASCADE)'\)/g)]
    .map(([, table, column, action]) => ({ table, column, action }));

describe(`migration ${FILE}`, () => {
    it('is in the migration chain and listed in the README chain with how to verify it', () => {
        assert.ok(migrations.includes(FILE), `${FILE} is in server/migrations`);
        assert.equal(migrations.filter((name) => name.startsWith('018_')).length, 1, 'one 018 migration');
        const readme = fs.readFileSync(new URL('README.md', DIR), 'utf8');
        assert.match(readme, /\| `018_account_deletion_and_legal\.sql` \| [^\n]*scripts\/db\/verify-account-deletion\.mjs/);
        assert.match(readme, /\| `018_account_deletion_and_legal\.sql` \| [^\n]*mcp_remote_role\.sql/);
        // Every signed-in request reads account_deletions: without 018 the app answers 503.
        assert.match(readme, /\| `018_account_deletion_and_legal\.sql` \| [^\n]*api・mcp・mcp-public を起動する前に適用/);
    });

    it('re-adds the four blocking FKs: authors SET NULL, a learner\'s jobs and MCP sessions CASCADE', () => {
        assert.deepEqual(overrides, [
            { table: 'curriculum_versions', column: 'created_by', action: 'SET NULL' },
            { table: 'approvals', column: 'decided_by', action: 'SET NULL' },
            { table: 'jobs', column: 'user_id', action: 'CASCADE' },
            { table: 'mcp_sessions', column: 'user_id', action: 'CASCADE' },
        ]);
        // Dropped by catalog lookup (whatever their names), then added again under a fixed name.
        assert.match(lower, /from pg_constraint c join pg_attribute a on a\.attrelid = c\.conrelid and a\.attname = fk\.col where c\.contype = 'f' and c\.conrelid = format\('public\.%i', fk\.tbl\)::regclass and c\.confrelid = 'auth\.users'::regclass and c\.conkey = array\[a\.attnum\]/);
        assert.match(lower, /execute format\('alter table public\.%i drop constraint %i', fk\.tbl, con\.conname\)/);
        assert.match(lower, /execute format\( 'alter table public\.%i add constraint %i foreign key \(%i\) references auth\.users\(id\) on delete %s', fk\.tbl, fk\.tbl \|\| '_' \|\| fk\.col \|\| '_fkey', fk\.col, fk\.action\)/);
    });

    it('after 018 no FK to auth.users is NO ACTION: every bare REFERENCES auth.users in any migration is one 018 overrides', () => {
        const bare = [];
        for (const name of migrations) {
            const { fks, total } = authUserFks(name);
            assert.equal(fks.length, total, `${name}: every reference to auth.users is a column FK this test can read`);
            for (const fk of fks) {
                if (fk.onDelete) continue;
                if (overrides.some((o) => o.table === fk.table && o.column === fk.column)) continue;
                bare.push(`${name}: ${fk.table}.${fk.column}`);
            }
        }
        assert.deepEqual(bare, [], 'a new FK to auth.users needs ON DELETE CASCADE or SET NULL, or account deletion fails');
        // The overrides name real FKs (a renamed column would leave one dangling).
        const all = migrations.flatMap((name) => authUserFks(name).fks);
        assert.ok(all.length >= 30, `the parser reads the FKs (found ${all.length})`);
        for (const o of overrides) assert.ok(all.some((fk) => fk.table === o.table && fk.column === o.column), `${o.table}.${o.column}`);
    });

    it('the proof tables and the tombstone have no FK to auth.users (they outlive the account)', () => {
        const bodies = tableBodies(sql);
        for (const table of ['account_deletions', 'legal_acceptances', 'account_consent_proofs', 'ai_app_provision_records', 'legal_document_versions']) {
            assert.ok(bodies.has(table), table);
            assert.doesNotMatch(bodies.get(table), /references auth\.users/, table);
        }
        assert.match(bodies.get('legal_acceptances'), /terms_version text not null references legal_document_versions\(version\)/);
    });

    it('account_deletions: one row per id, who asked (self, staff, orphan), re-open after the deletion', () => {
        const body = tableBodies(sql).get('account_deletions');
        assert.match(body, /^ user_id uuid primary key, deleted_at timestamptz not null, requested_by text not null check \(requested_by in \('self', 'staff', 'orphan'\)\), reopened_at timestamptz null, check \(reopened_at is null or reopened_at >= deleted_at\) $/);
        assert.match(lower, /create index if not exists account_deletions_deleted_at_idx on account_deletions \(deleted_at\);/);
    });

    it('the auth.users trigger takes the shared account lock before it reads the tombstone, and skips the stub', () => {
        const fn = /create or replace function public\.rp_skip_deleted_account_stub\(\) returns trigger (.*?) end \$\$;/.exec(lower)?.[1];
        assert.ok(fn, 'the trigger function');
        assert.match(fn, /language plpgsql volatile set search_path = pg_catalog, public as \$\$ begin/);
        const lock = fn.indexOf("perform pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || new.id::text, 0));");
        const read = fn.indexOf('if exists (select 1 from public.account_deletions d where d.user_id = new.id and d.reopened_at is null) then return null;');
        assert.ok(lock >= 0, 'shared lock on the canonical key');
        assert.ok(read > lock, 'the lock comes first, so the read sees a deletion that committed while it waited');
        assert.match(fn, /end if; return new;$/);
        assert.match(lower, /do \$\$ begin create trigger users_skip_deleted_account before insert on auth\.users for each row execute function public\.rp_skip_deleted_account_stub\(\); exception when duplicate_object then null; end \$\$;/);
    });

    it('legal_document_versions: version ids by document, sha256, never updated or deleted', () => {
        const body = tableBodies(sql).get('legal_document_versions');
        assert.ok(body.includes("version text primary key check (version ~ '^(terms|privacy)-(draft-)?[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[0-9]{1,2})?$')"), body);
        assert.match(body, /sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
        assert.match(body, /check \(starts_with\(version, document \|\| '-'\)\)/);
        assert.match(lower, /create or replace function public\.rp_rows_immutable\(\) returns trigger language plpgsql as \$\$ begin raise exception '% rows never change', tg_table_name using errcode = 'restrict_violation'; end \$\$;/);
        assert.match(lower, /create trigger legal_document_versions_immutable before update or delete on legal_document_versions for each row execute function public\.rp_rows_immutable\(\);/);
    });

    it('legal_acceptances: one live row per (account, versions), marked (not deleted) with the account', () => {
        const body = tableBodies(sql).get('legal_acceptances');
        assert.match(body, /account_deleted_at timestamptz null, check \(account_deleted_at is null or account_deleted_at >= accepted_at\)/);
        assert.doesNotMatch(body, /\b(ip|user_agent|email|name)\b/, 'only the id, the versions and the time');
        assert.match(lower, /create unique index if not exists legal_acceptances_live_uniq on legal_acceptances \(user_id, terms_version, privacy_version\) where account_deleted_at is null;/);
    });

    it('consent proofs and AI-app provision records keep only the allowed columns', () => {
        const bodies = tableBodies(sql);
        assert.match(bodies.get('account_consent_proofs'), /^ consent_id uuid primary key, user_id uuid not null, kind text not null, policy_version text not null, method text not null, given_at timestamptz not null, revoked_at timestamptz null, account_deleted_at timestamptz not null $/);
        assert.match(bodies.get('ai_app_provision_records'), /primary key \(user_id, client_id, account_deleted_at\)/);
        assert.doesNotMatch(bodies.get('account_consent_proofs'), /relationship|recorded_by/);
    });

    it('jobs retention index covers every status (a job left running is pruned too)', () => {
        assert.match(lower, /create index if not exists jobs_updated_idx on jobs \(updated_at\);/);
        assert.doesNotMatch(lower, /jobs_updated_idx on jobs \(updated_at\) where/);
    });

    it('grants: only SELECT (user_id, deleted_at, reopened_at) on account_deletions, only when the remote role exists', () => {
        const grants = lower.match(/grant [^;]+;/g) || [];
        assert.deepEqual(grants, ['grant select (user_id, deleted_at, reopened_at) on account_deletions to risepath_mcp_remote;']);
        assert.match(lower, /if exists \(select 1 from pg_roles where rolname = 'risepath_mcp_remote'\) then grant select/);
        assert.doesNotMatch(lower, /row level security|revoke /);
    });

    it('runs inside the migrator\'s transaction: no CONCURRENTLY, no BEGIN/COMMIT of its own, re-runnable', () => {
        assert.doesNotMatch(lower, /concurrently/);
        assert.doesNotMatch(lower, /(^|;) ?(begin|commit);/);
        assert.equal((lower.match(/create table (?!if not exists)/g) || []).length, 0);
        assert.equal((lower.match(/create (unique )?index (?!if not exists)/g) || []).length, 0);
        assert.equal((lower.match(/create trigger/g) || []).length, (lower.match(/exception when duplicate_object then null/g) || []).length);
    });
});
