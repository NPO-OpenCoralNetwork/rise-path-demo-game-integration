// Access-token verifier of the remote MCP endpoint (mcp-server/oauthVerifier.js), against a fake
// Supabase on 127.0.0.1 (helpers/fakeSupabase.js) and the real supabase-js getClaims:
// - a good token gives the SDK's AuthInfo with the user id;
// - expired, wrong issuer, wrong audience (an ID token's aud is its client id), no client_id,
//   anonymous, wrong role, a bad signature and a revoked grant are InvalidTokenError (401);
// - HS256, missing kid and malformed tokens never reach Supabase; an unknown kid refetches the JWKS
//   at most once a minute and never calls /auth/v1/user;
// - Supabase or the database not answering is AuthUnavailableError (503), never a 401.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { AuthUnavailableError, createOAuthVerifier, NOT_REVOKED_CACHE_MS, parseTokenHeader, REVOCATION_CACHE_MS } from '../../mcp-server/oauthVerifier.js';
import { makeEs256Key, signJwt, startFakeSupabase } from './helpers/fakeSupabase.js';

const RESOURCE = 'https://mcp.example.org/mcp';
const USER = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000001';

/** A pool that answers the revocation lookup from `revoked` ({ user|client: revokedAtSeconds }). */
const grantsPool = ({ revoked = {}, fail = false } = {}) => {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            queries.push({ sql, params });
            if (fail) throw new Error('db down');
            if (/FROM mcp_oauth_grants/.test(sql)) {
                const at = revoked[`${params[0]}|${params[1]}`];
                return { rows: at !== undefined && at > params[2] ? [{ '?column?': 1 }] : [] };
            }
            return { rows: [] };
        },
    };
};

describe('remote MCP access-token verifier', () => {
    let fake;
    let supabase;
    let clock;
    const quiet = { warn: () => {}, error: () => {} };
    const make = (options = {}) => createOAuthVerifier({
        issuer: fake.issuer,
        resource: RESOURCE,
        supabase,
        getPool: () => options.pool ?? grantsPool(),
        now: () => clock.now,
        logger: quiet,
        ...options,
    });
    const token = (overrides, signOptions) => fake.accessToken({ resource: RESOURCE, sub: USER, clientId: CLIENT }, overrides, signOptions);
    const rejects401 = (promise) => assert.rejects(promise, (error) => error instanceof InvalidTokenError);

    before(async () => {
        fake = await startFakeSupabase();
        supabase = createClient(fake.url, 'anon-key-for-tests', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    });
    after(async () => { await fake.close(); });
    beforeEach(() => {
        fake.resetCalls();
        fake.state.jwksDown = false;
        clock = { now: Date.now() };
    });

    it('returns AuthInfo for a good token: client id, no scopes, exp, the user id', async () => {
        const t = token();
        const info = await make().verifyAccessToken(t);
        assert.equal(info.token, t);
        assert.equal(info.clientId, CLIENT);
        assert.deepEqual(info.scopes, []);
        assert.equal(typeof info.expiresAt, 'number');
        assert.equal(info.extra.userId, USER);
        assert.equal(fake.calls.user, 0, 'getClaims verified with our keys, offline');
        assert.equal(fake.calls.jwks, 1, 'one JWKS fetch');
    });

    it('accepts an aud array that includes the resource', async () => {
        const info = await make().verifyAccessToken(token({ aud: [RESOURCE, 'authenticated'] }));
        assert.equal(info.extra.userId, USER);
    });

    it('expired: InvalidTokenError (so the client refreshes), not a generic error', async () => {
        const now = Math.floor(Date.now() / 1000);
        await rejects401(make().verifyAccessToken(token({ exp: now - 10, iat: now - 3610 })));
    });

    for (const [label, overrides] of [
        ['the app audience (a learner session token)', { aud: 'authenticated', client_id: null }],
        ['an ID token (aud = client id)', { aud: CLIENT }],
        ['another resource', { aud: 'https://mcp.example.org/other' }],
        ['a trailing-slash resource', { aud: `${RESOURCE}/` }],
        ['no client_id', { client_id: null }],
        ['a client_id that is not a UUID', { client_id: 'claude' }],
        ['another issuer', { iss: 'https://evil.example/auth/v1' }],
        ['role anon', { role: 'anon' }],
        ['an anonymous user', { is_anonymous: true }],
        ['a sub that is not a UUID', { sub: 'admin' }],
        ['no iat', { iat: null }],
    ]) {
        it(`refuses ${label}`, async () => {
            await rejects401(make().verifyAccessToken(token(overrides)));
            assert.equal(fake.calls.user, 0);
        });
    }

    it('refuses a token signed by another key under the same kid', async () => {
        const impostor = makeEs256Key('test-key-1');
        await rejects401(make().verifyAccessToken(token({}, { key: impostor })));
        assert.equal(fake.calls.user, 0);
    });

    it('HS256, no kid, RS-less garbage: refused before any call to Supabase', async () => {
        const verifier = make();
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: fake.issuer, aud: RESOURCE, sub: USER, client_id: CLIENT, role: 'authenticated', exp: now + 60, iat: now };
        for (const bad of [
            signJwt(claims, { alg: 'HS256', kid: 'test-key-1' }),
            signJwt(claims, { key: fake.signing, kid: null }),
            signJwt(claims, { key: fake.signing, alg: 'none' }),
            'not-a-jwt',
            'a.b',
            `${'x'.repeat(10)}.${'y'.repeat(10)}.${'z'.repeat(10)}`,
        ]) {
            await rejects401(verifier.verifyAccessToken(bad));
        }
        assert.equal(fake.totalCalls(), 0, 'no JWKS fetch and no /user call');
        assert.equal(parseTokenHeader(signJwt(claims, { alg: 'HS256', kid: 'k' })), null);
    });

    it('unknown kid: at most one JWKS refetch a minute, never /auth/v1/user', async () => {
        const verifier = make();
        await verifier.verifyAccessToken(token());
        assert.equal(fake.calls.jwks, 1);
        const stranger = makeEs256Key('unknown-kid');
        clock.now += 61_000;
        await rejects401(verifier.verifyAccessToken(token({}, { key: stranger })));
        await rejects401(verifier.verifyAccessToken(token({}, { key: stranger })));
        await rejects401(verifier.verifyAccessToken(token({}, { key: stranger })));
        assert.equal(fake.calls.jwks, 2, 'one refetch for three unknown-kid tokens');
        assert.equal(fake.calls.user, 0);
        clock.now += 61_000;
        await rejects401(verifier.verifyAccessToken(token({}, { key: stranger })));
        assert.equal(fake.calls.jwks, 3, 'a minute later, one more');
    });

    it('a new signing key (rotation) is picked up by the unknown-kid refetch', async () => {
        const verifier = make();
        await verifier.verifyAccessToken(token());
        const next = makeEs256Key('test-key-2');
        fake.state.published = [fake.signing, next];
        clock.now += 61_000;
        const info = await verifier.verifyAccessToken(token({}, { key: next }));
        assert.equal(info.extra.userId, USER);
        fake.state.published = [fake.signing];
    });

    it('JWKS unreachable with no keys yet: AuthUnavailableError (503), and no call per request', async () => {
        fake.state.jwksDown = true;
        const verifier = make();
        await assert.rejects(verifier.verifyAccessToken(token()), AuthUnavailableError);
        await assert.rejects(verifier.verifyAccessToken(token()), AuthUnavailableError);
        assert.equal(fake.calls.jwks, 1, 'the second request did not refetch');
        fake.state.jwksDown = false;
        clock.now += 6_000;
        assert.equal((await verifier.verifyAccessToken(token())).extra.userId, USER, 'recovers');
    });

    it('JWKS down after a good fetch: stale keys keep working', async () => {
        const verifier = make();
        await verifier.verifyAccessToken(token());
        fake.state.jwksDown = true;
        clock.now += 11 * 60_000;
        assert.equal((await verifier.verifyAccessToken(token())).extra.userId, USER);
    });

    it('revoked after the token was issued: 401; a token issued after the revoke passes', async () => {
        const now = Math.floor(Date.now() / 1000);
        const pool = grantsPool({ revoked: { [`${USER}|${CLIENT}`]: now - 2 } });
        const verifier = make({ pool });
        await rejects401(verifier.verifyAccessToken(token({ iat: now - 60 })));
        assert.equal((await verifier.verifyAccessToken(token({ iat: now }))).extra.userId, USER);
        assert.match(pool.queries[0].sql, /revoked_at > to_timestamp\(\$3\)/);
    });

    it('the revocation lookup is cached per (user, client, iat), so a flood costs one query, and a revoke lands within a few seconds', async () => {
        const now = Math.floor(Date.now() / 1000);
        const revoked = {};
        const pool = grantsPool({ revoked });
        const verifier = make({ pool });
        const t = token({ iat: now - 10 });
        await Promise.all(Array.from({ length: 5 }, () => verifier.verifyAccessToken(t)));
        for (let i = 0; i < 5; i += 1) await verifier.verifyAccessToken(t);
        assert.equal(pool.queries.length, 1, 'concurrent and repeated requests share one lookup');
        // A token with another iat (or another client) is its own lookup.
        await verifier.verifyAccessToken(token({ iat: now - 9 }));
        assert.equal(pool.queries.length, 2);

        revoked[`${USER}|${CLIENT}`] = now - 1;
        clock.now += NOT_REVOKED_CACHE_MS - 1000;
        await verifier.verifyAccessToken(t);
        assert.equal(pool.queries.length, 2, "a 'not revoked' answer is still cached just inside its TTL");
        clock.now += 2000;
        await rejects401(verifier.verifyAccessToken(t));
        assert.equal(pool.queries.length, 3, 'asked again after the TTL, and the revoke applies');
        clock.now += REVOCATION_CACHE_MS - 1000;
        await rejects401(verifier.verifyAccessToken(t));
        assert.equal(pool.queries.length, 3, "the 'revoked' answer is cached for longer");
    });

    it("a 'not revoked' answer is reused for at most a few seconds, so a disconnect is not delayed by the longer revoked TTL", async () => {
        assert.ok(NOT_REVOKED_CACHE_MS <= 5000, 'a disconnect applies within a few seconds');
        assert.ok(NOT_REVOKED_CACHE_MS < REVOCATION_CACHE_MS);
        const now = Math.floor(Date.now() / 1000);
        const revoked = {};
        const pool = grantsPool({ revoked });
        const verifier = make({ pool });
        const t = token({ iat: now - 10 });
        assert.equal((await verifier.verifyAccessToken(t)).extra.userId, USER);
        // The api container writes revoked_at; this process cannot clear its cache.
        revoked[`${USER}|${CLIENT}`] = now - 1;
        clock.now += 5000;
        await rejects401(verifier.verifyAccessToken(t));
        assert.equal(pool.queries.length, 2);
    });

    it('a token minted between the two revoke writes passes until the second write, then is refused', async () => {
        const now = Math.floor(Date.now() / 1000);
        const revoked = {};
        const pool = grantsPool({ revoked });
        const verifier = make({ pool });
        // First write (before revokeGrant): the agent refreshes a second later and gets a new token.
        revoked[`${USER}|${CLIENT}`] = now;
        const windowToken = token({ iat: now + 1 });
        assert.equal((await verifier.verifyAccessToken(windowToken)).extra.userId, USER, 'the window token passes the first write');
        // revokeGrant succeeds, the front writes revoked_at again.
        revoked[`${USER}|${CLIENT}`] = now + 2;
        clock.now += NOT_REVOKED_CACHE_MS;
        await rejects401(verifier.verifyAccessToken(windowToken));
    });

    it('a failed revocation lookup is not cached', async () => {
        const failing = { fail: true, queries: 0, async query() { this.queries += 1; if (this.fail) throw new Error('db down'); return { rows: [] }; } };
        const verifier = make({ pool: failing });
        const t = token();
        await assert.rejects(verifier.verifyAccessToken(t), AuthUnavailableError);
        failing.fail = false;
        assert.equal((await verifier.verifyAccessToken(t)).extra.userId, USER);
        assert.equal(failing.queries, 2);
    });

    it('the grants lookup failing or no database: AuthUnavailableError (fail closed)', async () => {
        await assert.rejects(make({ pool: grantsPool({ fail: true }) }).verifyAccessToken(token()), AuthUnavailableError);
        await assert.rejects(createOAuthVerifier({ issuer: fake.issuer, resource: RESOURCE, supabase, getPool: () => null, logger: quiet }).verifyAccessToken(token()), AuthUnavailableError);
    });

    it('error messages never contain the token', async () => {
        const t = token({ aud: 'authenticated' });
        await assert.rejects(make().verifyAccessToken(t), (error) => !String(error.message).includes(t) && !String(error.message).includes(t.split('.')[1]));
    });
});
