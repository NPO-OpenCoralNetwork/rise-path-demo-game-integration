// Deleted Rise Path accounts (Phase 4, migration 018): token times (tools/core/oauthToken.js) and
// the account state every entry point asks (tools/core/accountDeletions.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeTokenClaims, passwordAuthTime, sessionAuthTime } from '../../tools/core/oauthToken.js';
import {
    ACCOUNT_SKEW_SECONDS,
    accountGeneration,
    accountLockKey,
    canonicalUserId,
    readAccountState,
    reopenAccount,
} from '../../tools/core/accountDeletions.js';
import { createAccountDeletionPool, norm } from './helpers/accountDeletionPool.js';

const ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const UPPER = ID.toUpperCase();
const DELETED_AT = new Date('2026-10-01T00:00:00Z');
const DELETED_S = DELETED_AT.getTime() / 1000;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1' })}.${b64(payload)}.c2ln`;

describe('token times (tools/core/oauthToken.js)', () => {
    it('decodeTokenClaims reads a JWT payload and nothing else', () => {
        assert.deepEqual(decodeTokenClaims(jwt({ sub: ID, amr: [] })), { sub: ID, amr: [] });
        for (const value of ['', 'opaque', 'a.b', 'a.!!!.c', `${b64({})}.${b64([1])}.x`, undefined, null, 42]) {
            assert.equal(decodeTokenClaims(value), null, String(value));
        }
    });

    it('sessionAuthTime is the newest numeric amr timestamp of object entries', () => {
        assert.equal(sessionAuthTime({ amr: [{ method: 'password', timestamp: 100 }, { method: 'otp', timestamp: 250 }] }), 250);
        assert.equal(sessionAuthTime({ amr: ['pwd', { method: 'password', timestamp: 100 }] }), 100, 'string entries are ignored');
        assert.equal(sessionAuthTime({ amr: [{ method: 'password', timestamp: '300' }, { timestamp: 120 }] }), 120, 'numeric timestamps only');
        assert.equal(sessionAuthTime({ amr: [{ timestamp: Number.POSITIVE_INFINITY }, { timestamp: Number.NaN }, null, [5]] }), null);
    });

    it('sessionAuthTime has no iat fallback: a refreshed token without amr has no sign-in time', () => {
        assert.equal(sessionAuthTime({ iat: 1_800_000_000 }), null);
        assert.equal(sessionAuthTime({ iat: 1_800_000_000, amr: [] }), null);
        assert.equal(sessionAuthTime({ iat: 1_800_000_000, auth_time: 1_800_000_000, amr: 'password' }), null);
        assert.equal(sessionAuthTime(null), null);
        assert.equal(sessionAuthTime(undefined), null);
    });

    it('passwordAuthTime takes only password entries', () => {
        const claims = { amr: [{ method: 'password', timestamp: 100 }, { method: 'oauth', timestamp: 500 }, { method: 'password', timestamp: 200 }] };
        assert.equal(passwordAuthTime(claims), 200);
        assert.equal(passwordAuthTime({ amr: [{ method: 'otp', timestamp: 500 }] }), null);
        assert.equal(passwordAuthTime({ amr: ['password'] }), null);
        assert.equal(passwordAuthTime({ iat: 999 }), null);
    });
});

describe('account ids and keys', () => {
    it('canonicalUserId lower-cases a UUID and refuses anything else', () => {
        assert.equal(canonicalUserId(UPPER), ID);
        assert.equal(canonicalUserId(ID), ID);
        for (const value of [`{${ID}}`, ID.replace(/-/g, ''), ` ${ID}`, `${ID}x`, '', null, undefined, 42]) {
            assert.equal(canonicalUserId(value), null, String(value));
        }
    });

    it('the lock key is built from the uuid text, as the auth.users trigger builds it', () => {
        assert.equal(accountLockKey(1), "hashtextextended('rp:account:' || $1::uuid::text, 0)");
        assert.equal(accountLockKey(3), "hashtextextended('rp:account:' || $3::uuid::text, 0)");
        const migration = fs.readFileSync(new URL('../migrations/018_account_deletion_and_legal.sql', import.meta.url), 'utf8');
        assert.ok(migration.includes("pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || NEW.id::text, 0))"));
    });

    it('accountGeneration is reopened_at in whole epoch seconds', () => {
        assert.equal(accountGeneration(new Date('2026-10-02T00:00:01.900Z')), Date.parse('2026-10-02T00:00:01Z') / 1000);
        assert.equal(accountGeneration('2026-10-02T00:00:01Z'), Date.parse('2026-10-02T00:00:01Z') / 1000);
        assert.equal(accountGeneration(null), null);
        assert.equal(accountGeneration(undefined), null);
        assert.equal(accountGeneration('not a date'), null);
    });
});

describe('readAccountState', () => {
    const tombstone = (extra = {}) => ({ [ID]: { deletedAt: DELETED_AT, ...extra } });

    it('without a pool (no database configured) the account is ok, without a query or an error', async () => {
        assert.deepEqual(await readAccountState(null, ID, null), { state: 'ok', generation: null });
        assert.deepEqual(await readAccountState(undefined, 'not-a-uuid', null, { mayReopen: true }), { state: 'ok', generation: null });
    });

    it('no tombstone: ok with no generation, one primary-key read', async () => {
        const pool = createAccountDeletionPool();
        assert.deepEqual(await readAccountState(pool, ID, DELETED_S, { mayReopen: true }), { state: 'ok', generation: null });
        assert.deepEqual(pool.state.queries.map((q) => q.sql), ['select deleted_at, reopened_at from account_deletions where user_id = $1::uuid']);
        assert.equal(pool.state.connects, 0, 'no transaction');
    });

    it('a pool answering without rows (other helper pools) is ok', async () => {
        assert.deepEqual(await readAccountState({ query: async () => ({}) }, ID, 1, { mayReopen: true }), { state: 'ok', generation: null });
        assert.deepEqual(await readAccountState({ query: async () => undefined }, ID, 1), { state: 'ok', generation: null });
    });

    it('a session that signed in up to 30 s after the deletion, or without a sign-in time, belongs to the deleted account', async () => {
        assert.equal(ACCOUNT_SKEW_SECONDS, 30);
        for (const authTime of [DELETED_S - 3600, DELETED_S, DELETED_S + 30, null, undefined, Number.NaN]) {
            const pool = createAccountDeletionPool({ tombstones: tombstone() });
            assert.deepEqual(await readAccountState(pool, ID, authTime, { mayReopen: true }), { state: 'deleted' }, String(authTime));
            assert.equal(pool.state.connects, 0, 'never re-opened');
        }
    });

    it('an old session stays deleted after a re-open', async () => {
        const pool = createAccountDeletionPool({ tombstones: tombstone({ reopenedAt: new Date(DELETED_AT.getTime() + 60_000) }) });
        assert.deepEqual(await readAccountState(pool, ID, DELETED_S + 10, { mayReopen: true }), { state: 'deleted' });
    });

    it('a session 31 s after the deletion re-opens the account (mayReopen) with reopened_at as its generation', async () => {
        const reopenedAt = new Date('2026-10-01T00:05:00.250Z');
        const pool = createAccountDeletionPool({ tombstones: tombstone(), now: () => reopenedAt });
        const result = await readAccountState(pool, ID, DELETED_S + 31, { mayReopen: true });
        assert.deepEqual(result, { state: 'ok', generation: Math.floor(reopenedAt.getTime() / 1000) });
        assert.ok(pool.state.stubs.has(ID), 'the stub is back');
        assert.ok(pool.state.resets.has(ID), 'a new lesson-progress epoch');
        assert.equal(pool.state.releases, 1);
    });

    it('without mayReopen (agents, SSE MCP) a new session of a deleted account stays deleted and nothing is written', async () => {
        const pool = createAccountDeletionPool({ tombstones: tombstone() });
        assert.deepEqual(await readAccountState(pool, ID, DELETED_S + 3600), { state: 'deleted' });
        assert.deepEqual(await readAccountState(pool, ID, DELETED_S + 3600, { mayReopen: false }), { state: 'deleted' });
        assert.equal(pool.state.connects, 0);
        assert.equal(pool.state.tombstones.get(ID).reopened_at, null);
    });

    it('an account re-opened before: ok with its generation, no second re-open', async () => {
        const reopenedAt = new Date('2026-10-01T01:00:00Z');
        const pool = createAccountDeletionPool({ tombstones: tombstone({ reopenedAt }) });
        assert.deepEqual(await readAccountState(pool, ID, DELETED_S + 7200, { mayReopen: true }), { state: 'ok', generation: reopenedAt.getTime() / 1000 });
        assert.equal(pool.state.connects, 0);
    });

    it('a query error throws (the caller fails closed)', async () => {
        await assert.rejects(readAccountState(createAccountDeletionPool({ failRead: true }), ID, 1, { mayReopen: true }), /account_deletions/);
        await assert.rejects(readAccountState({ query: async () => { throw new Error('down'); } }, ID, 1), /down/);
    });

    it('an id that is not a UUID is never let through without a check', async () => {
        const pool = createAccountDeletionPool();
        await assert.rejects(readAccountState(pool, 'user-1', 1), TypeError);
        await assert.rejects(readAccountState(pool, ID.replace(/-/g, ''), 1), TypeError);
        assert.equal(pool.state.queries.length, 0);
    });

    it('an upper-case id reaches every statement lower-cased, cast with $1::uuid, and locks on $1::uuid::text', async () => {
        const pool = createAccountDeletionPool({ tombstones: tombstone() });
        const result = await readAccountState(pool, UPPER, DELETED_S + 120, { mayReopen: true });
        assert.equal(result.state, 'ok', 'the tombstone keyed by the lower-case id was found and re-opened');
        const statements = pool.state.queries.filter((q) => !['begin', 'commit', 'rollback'].includes(q.sql));
        assert.ok(statements.length >= 5);
        for (const q of statements) {
            assert.equal(q.params[0], ID, q.sql);
            assert.match(q.sql, /\$1::uuid/, q.sql);
            assert.doesNotMatch(q.sql, /\$1(?!::uuid)/, `every use of $1 is cast: ${q.sql}`);
        }
        const lock = statements.find((q) => q.sql.startsWith('select pg_advisory_xact_lock_shared('));
        assert.equal(lock.sql, norm(`select pg_advisory_xact_lock_shared(${accountLockKey(1)})`));
    });
});

describe('reopenAccount', () => {
    it('one transaction: the shared lock before the UPDATE, then the stub and the epoch, then COMMIT', async () => {
        const pool = createAccountDeletionPool({ tombstones: { [ID]: { deletedAt: DELETED_AT } } });
        const reopenedAt = await reopenAccount(pool, ID, DELETED_S + 60);
        assert.ok(reopenedAt instanceof Date);
        const sqls = pool.state.queries.map((q) => q.sql);
        assert.deepEqual(sqls.map((s) => s.split(' ').slice(0, 3).join(' ')), [
            'begin',
            "select pg_advisory_xact_lock_shared(hashtextextended('rp:account:' ||",
            'update account_deletions set',
            'insert into auth.users',
            'insert into lesson_progress_resets',
            'commit',
        ]);
        assert.ok(pool.state.queries.every((q) => q.tx), 'all on one connected client');
        assert.match(sqls[2], /^update account_deletions set reopened_at = now\(\) where user_id = \$1::uuid and reopened_at is null and to_timestamp\(\$2::double precision\) > deleted_at \+ interval '30 seconds' returning reopened_at$/);
        assert.equal(sqls[3], 'insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing');
        assert.equal(sqls[4], 'insert into lesson_progress_resets (user_id) values ($1::uuid) on conflict (user_id) do update set epoch = gen_random_uuid(), reset_at = now()');
        assert.deepEqual(pool.state.resets.get(ID), { reset_at: reopenedAt }, 'reset_at = reopened_at (the same now())');
    });

    it('a parallel first request re-opened it already: same reopened_at back, no stub insert, no second epoch', async () => {
        const reopenedAt = new Date(DELETED_AT.getTime() + 90_000);
        const pool = createAccountDeletionPool({
            tombstones: { [ID]: { deletedAt: DELETED_AT } },
            onLock: (state) => { state.tombstones.get(ID).reopened_at = reopenedAt; },
        });
        assert.deepEqual(await readAccountState(pool, ID, DELETED_S + 60, { mayReopen: true }), { state: 'ok', generation: reopenedAt.getTime() / 1000 });
        const sqls = pool.state.queries.map((q) => q.sql);
        assert.ok(!sqls.some((s) => s.startsWith('insert into')), 'nothing inserted');
        assert.equal(sqls.at(-1), 'commit');
    });

    it('re-opened and deleted again since the first read: this older session stays deleted', async () => {
        const deletedAgain = new Date(DELETED_AT.getTime() + 600_000);
        const pool = createAccountDeletionPool({
            tombstones: { [ID]: { deletedAt: DELETED_AT } },
            // Committed while this request waited for the lock: a re-open by another session, then a
            // second deletion (reopened_at NULL again, a later deleted_at).
            onLock: (state) => { state.tombstones.set(ID, { deleted_at: deletedAgain, reopened_at: null }); },
        });
        assert.deepEqual(await readAccountState(pool, ID, DELETED_S + 60, { mayReopen: true }), { state: 'deleted' });
        assert.equal(pool.state.tombstones.get(ID).reopened_at, null, 'not re-opened');
        assert.ok(!pool.state.stubs.has(ID) && !pool.state.resets.has(ID));
    });

    it('a failing statement rolls back and releases the client', async () => {
        let released = 0;
        const queries = [];
        const pool = {
            query: async () => ({ rows: [{ deleted_at: DELETED_AT, reopened_at: null }] }),
            connect: async () => ({
                query: async (sql) => {
                    queries.push(norm(sql));
                    if (norm(sql).startsWith('update')) throw new Error('lock timeout');
                    return { rows: [] };
                },
                release: () => { released += 1; },
            }),
        };
        await assert.rejects(readAccountState(pool, ID, DELETED_S + 60, { mayReopen: true }), /lock timeout/);
        assert.equal(queries.at(-1), 'rollback');
        assert.equal(released, 1);
    });

    it('refuses a missing sign-in time without touching the database', async () => {
        const pool = createAccountDeletionPool({ tombstones: { [ID]: { deletedAt: DELETED_AT } } });
        assert.equal(await reopenAccount(pool, ID, null), null);
        assert.equal(pool.state.connects, 0);
    });
});
