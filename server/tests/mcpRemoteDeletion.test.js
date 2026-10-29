// The remote MCP endpoint (mcp-public, mcp-server/oauthVerifier.js) refuses the tokens of a
// deleted Rise Path account (Phase 4, migration 018). Supabase keeps issuing tokens for the shared
// login, so the refusal comes from account_deletions, read in the same statement as the grants
// (one query per uncached token). mcp-public never re-opens an account: only the app does.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createOAuthVerifier, isGrantRevoked, NOT_REVOKED_CACHE_MS } from '../../mcp-server/oauthVerifier.js';
import { startFakeSupabase } from './helpers/fakeSupabase.js';

const RESOURCE = 'https://mcp.example.org/mcp';
const USER = 'b2b2b2b2-0000-4000-8000-0000000000b2';
const CLIENT = 'c2c2c2c2-0000-4000-8000-0000000000c2';
const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

/**
 * The account_deletions branch's conditions, each applied only when the statement has it (so a
 * clause removed from oauthVerifier.js changes the answers below, not only the SQL-text pin):
 * `reopened_at IS NULL`, `$4::double precision IS NULL` (no auth time) and
 * `to_timestamp($4) <= deleted_at [+ interval 'N seconds']` (to_timestamp(NULL) is NULL: false).
 */
const tombstoneRefuses = (sql, t, authTime) => {
    const notReopened = sql.includes('reopened_at IS NULL') && t.reopenedAt == null;
    const noAuthTime = sql.includes('$4::double precision IS NULL') && authTime == null;
    const before = /to_timestamp\(\$4\) <= deleted_at(?: \+ interval '(\d+) seconds')?/.exec(sql);
    const signedInBefore = Boolean(before) && authTime != null && authTime <= t.deletedAt + Number(before?.[1] ?? 0);
    return notReopened || noAuthTime || signedInBefore;
};

/**
 * The verifier's one statement, answered like Postgres: the grants branch from `revoked`
 * ({ user|client: revokedAtSeconds }), the account_deletions branch from `tombstones`
 * ({ user: { deletedAt, reopenedAt } } in epoch seconds) when the statement has that branch.
 */
const verifierPool = ({ revoked = {}, tombstones = {} } = {}) => {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            const text = norm(sql);
            queries.push({ sql: text, params });
            const [userId, clientId, iat, authTime] = params;
            const at = revoked[`${userId}|${clientId}`];
            if (at !== undefined && at > iat) return { rows: [{ '?column?': 1 }] };
            const t = tombstones[userId];
            if (t && text.includes('FROM account_deletions') && tombstoneRefuses(text, t, authTime)) {
                return { rows: [{ '?column?': 1 }] };
            }
            return { rows: [] };
        },
    };
};

describe('remote MCP verifier: deleted accounts', () => {
    let fake;
    let supabase;
    let clock;
    const quiet = { warn: () => {}, error: () => {} };
    const make = (pool) => createOAuthVerifier({
        issuer: fake.issuer,
        resource: RESOURCE,
        supabase,
        getPool: () => pool,
        now: () => clock.now,
        logger: quiet,
    });
    /** An agent token; authorizedAt: the amr time Supabase keeps across refreshes. */
    const token = ({ authorizedAt, iat, amr } = {}) => {
        const now = Math.floor(clock.now / 1000);
        return fake.accessToken({ resource: RESOURCE, sub: USER, clientId: CLIENT }, {
            iat: iat ?? now - 5,
            ...(amr !== undefined ? { amr } : { amr: [{ method: 'oauth_provider/authorization_code', timestamp: authorizedAt ?? now - 5 }] }),
        });
    };
    const rejects401 = (promise) => assert.rejects(promise, (error) => error instanceof InvalidTokenError);

    before(async () => {
        fake = await startFakeSupabase();
        supabase = createClient(fake.url, 'anon-key-for-tests', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    });
    after(async () => { await fake.close(); });
    beforeEach(() => {
        fake.resetCalls();
        clock = { now: Date.now() };
    });

    it('one statement: the grants branch first ($1-$3 as before), then the tombstone branch with the auth time as $4', async () => {
        const pool = verifierPool();
        await isGrantRevoked(pool, { userId: USER, clientId: CLIENT, iat: 100, authTime: 90 });
        const [{ sql, params }] = pool.queries;
        assert.match(sql, /^SELECT 1 FROM mcp_oauth_grants WHERE user_id = \$1 AND client_id = \$2 AND revoked_at IS NOT NULL AND revoked_at > to_timestamp\(\$3\) UNION ALL SELECT 1 FROM account_deletions WHERE user_id = \$1 /);
        assert.ok(sql.includes("AND (reopened_at IS NULL OR $4::double precision IS NULL OR to_timestamp($4) <= deleted_at + interval '30 seconds') LIMIT 1"), sql);
        assert.deepEqual(params, [USER, CLIENT, 100, 90]);
        await isGrantRevoked(pool, { userId: USER, clientId: CLIENT, iat: 100 });
        assert.deepEqual(pool.queries[1].params, [USER, CLIENT, 100, null], 'no auth time is sent as NULL (refused when a tombstone exists)');
    });

    it('a deleted account that was not re-opened: every agent token is refused (401), even one authorized after the deletion', async () => {
        const now = Math.floor(clock.now / 1000);
        const pool = verifierPool({ tombstones: { [USER]: { deletedAt: now - 3600, reopenedAt: null } } });
        const verifier = make(pool);
        await rejects401(verifier.verifyAccessToken(token({ authorizedAt: now - 7200 })));
        await rejects401(verifier.verifyAccessToken(token({ authorizedAt: now - 60 })));
    });

    it('a re-opened account: an agent authorized before the deletion (+30 s) stays refused; one authorized after passes; no amr is refused', async () => {
        const now = Math.floor(clock.now / 1000);
        const pool = verifierPool({ tombstones: { [USER]: { deletedAt: now - 3600, reopenedAt: now - 1800 } } });
        const verifier = make(pool);
        // A refreshed token: a new iat, the old authorization time.
        await rejects401(verifier.verifyAccessToken(token({ authorizedAt: now - 7200, iat: now - 5 })));
        await rejects401(verifier.verifyAccessToken(token({ authorizedAt: now - 3600 + 30 })));
        await rejects401(verifier.verifyAccessToken(token({ amr: null })));
        const info = await verifier.verifyAccessToken(token({ authorizedAt: now - 3600 + 31 }));
        assert.equal(info.extra.userId, USER);
    });

    it('AuthInfo carries the auth time (newest amr timestamp), null without amr', async () => {
        const now = Math.floor(clock.now / 1000);
        const verifier = make(verifierPool());
        const info = await verifier.verifyAccessToken(token({ amr: [{ method: 'password', timestamp: now - 900 }, { method: 'oauth_provider/authorization_code', timestamp: now - 300 }] }));
        assert.deepEqual(info.extra, { userId: USER, iat: info.extra.iat, authTime: now - 300 });
        assert.equal((await verifier.verifyAccessToken(token({ amr: null }))).extra.authTime, null);
    });

    it('the cache key includes the auth time: tokens with the same iat but another sign-in are separate lookups', async () => {
        const now = Math.floor(clock.now / 1000);
        const pool = verifierPool();
        const verifier = make(pool);
        await verifier.verifyAccessToken(token({ iat: now - 10, authorizedAt: now - 100 }));
        await verifier.verifyAccessToken(token({ iat: now - 10, authorizedAt: now - 100 }));
        assert.equal(pool.queries.length, 1, 'same (user, client, iat, auth time): one lookup');
        await verifier.verifyAccessToken(token({ iat: now - 10, authorizedAt: now - 50 }));
        assert.equal(pool.queries.length, 2, 'another auth time: its own lookup');
        assert.equal(pool.queries[1].params[3], now - 50);
    });

    it('a deletion after a cached "fine" answer applies within NOT_REVOKED_CACHE_MS', async () => {
        const now = Math.floor(clock.now / 1000);
        const tombstones = {};
        const pool = verifierPool({ tombstones });
        const verifier = make(pool);
        const t = token({ authorizedAt: now - 600 });
        assert.equal((await verifier.verifyAccessToken(t)).extra.userId, USER);
        // The api container deletes the account; this process cannot clear its cache.
        tombstones[USER] = { deletedAt: now, reopenedAt: null };
        clock.now += NOT_REVOKED_CACHE_MS - 1000;
        assert.equal((await verifier.verifyAccessToken(t)).extra.userId, USER, 'still inside the short TTL');
        clock.now += 2000;
        await rejects401(verifier.verifyAccessToken(t));
        assert.equal(pool.queries.length, 2);
    });
});
