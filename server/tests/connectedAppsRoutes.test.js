// The learner's connected apps (server/routes/connectedApps.js at /api/v2/user/connected-apps) on
// the real server.js stack: list and revoke touch only the caller's own mcp_oauth_grants rows, and
// an agent's own OAuth token (client_id) can neither list nor revoke (401 oauth_client_token).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';

const ALICE = 'aaaaaaaa-1111-4000-8000-000000000001';
const BOB = 'aaaaaaaa-1111-4000-8000-000000000002';
const CLAUDE = '11111111-2222-4000-8000-000000000001';
const CODEX = '11111111-2222-4000-8000-000000000002';
const NEVER_USED = '11111111-2222-4000-8000-000000000003';
const MCP_URL = 'https://mcp.example.org/mcp';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ role: 'authenticated', exp: 4_000_000_000, ...payload })}.c2ln`;
const TOKENS = {
    alice: jwt({ sub: ALICE, aud: 'authenticated' }),
    bob: jwt({ sub: BOB, aud: 'authenticated' }),
    aliceAgent: jwt({ sub: ALICE, aud: MCP_URL, client_id: CLAUDE }),
};
const USERS = { [TOKENS.alice]: ALICE, [TOKENS.bob]: BOB, [TOKENS.aliceAgent]: ALICE };
const as = (who) => ({ Authorization: `Bearer ${TOKENS[who]}` });

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY'];

const lower = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

/** In-memory mcp_oauth_grants keyed `${user}|${client}`; records every statement. */
function createGrantsPool(initial = []) {
    const grants = new Map(initial.map((row) => [`${row.user_id}|${row.client_id}`, { client_name: null, revoked_at: null, ...row }]));
    const queries = [];
    let failing = false;
    const query = async (sql, params = []) => {
        const text = lower(sql);
        queries.push({ sql: text, params });
        if (text.startsWith('insert into auth.users')) return { rowCount: 1, rows: [] };
        if (failing && text.includes('mcp_oauth_grants')) throw Object.assign(new Error('relation "mcp_oauth_grants" does not exist'), { code: '42P01' });
        if (text.startsWith('select client_id, client_name, first_seen_at, last_used_at, revoked_at from mcp_oauth_grants')) {
            // ORDER BY COALESCE(last_used_at, revoked_at) DESC NULLS LAST
            const when = (row) => (row.last_used_at ?? row.revoked_at)?.getTime() ?? -Infinity;
            const rows = [...grants.values()]
                .filter((row) => row.user_id === params[0])
                .sort((a, b) => when(b) - when(a));
            return { rowCount: rows.length, rows };
        }
        if (text.startsWith('insert into mcp_oauth_grants')) {
            // Models the route's upsert: a new row has no first or last use; a stored name is kept
            // when the request carries none.
            const [userId, clientId, clientName = null] = params;
            const key = `${userId}|${clientId}`;
            const now = new Date();
            const existing = grants.get(key);
            if (existing) {
                existing.revoked_at = now;
                existing.client_name = clientName ?? existing.client_name;
            } else {
                grants.set(key, { user_id: userId, client_id: clientId, client_name: clientName, first_seen_at: null, last_used_at: null, revoked_at: now });
            }
            return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
    };
    return { query, grants, queries, fail: () => { failing = true; } };
}

const withServer = async (handler) => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        await handler(`http://127.0.0.1:${server.address().port}/api/v2/user/connected-apps`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
};

const call = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const response = body === undefined
        ? await fetch(url, { method, headers })
        : await fetch(url, { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON
    }
    return { status: response.status, json, text };
};

const at = (iso) => new Date(iso);

describe('/api/v2/user/connected-apps', () => {
    const saved = {};
    let pool;

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        for (const key of ENV_KEYS) delete process.env[key];
        process.env.NODE_ENV = 'production';
        resetPoolForTests();
        pool = createGrantsPool([
            { user_id: ALICE, client_id: CLAUDE, client_name: 'Claude', first_seen_at: at('2026-10-01T00:00:00Z'), last_used_at: at('2026-10-20T00:00:00Z') },
            { user_id: ALICE, client_id: CODEX, client_name: 'Codex', first_seen_at: at('2026-10-02T00:00:00Z'), last_used_at: at('2026-10-22T00:00:00Z'), revoked_at: at('2026-10-22T01:00:00Z') },
            { user_id: BOB, client_id: CLAUDE, client_name: 'Claude', first_seen_at: at('2026-10-03T00:00:00Z'), last_used_at: at('2026-10-21T00:00:00Z') },
        ]);
        setPoolForTests(pool);
        setSupabaseForTests({
            auth: { getUser: async (token) => ({ data: { user: USERS[token] ? { id: USERS[token] } : null }, error: null }) },
        });
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        setSupabaseForTests(null);
        resetPoolForTests();
    });

    it('GET lists only the caller\'s apps, most recently used first', async () => {
        await withServer(async (base) => {
            const alice = await call(base, { headers: as('alice') });
            assert.equal(alice.status, 200, alice.text);
            assert.deepEqual(alice.json, {
                apps: [
                    { clientId: CODEX, clientName: 'Codex', firstSeenAt: '2026-10-02T00:00:00.000Z', lastUsedAt: '2026-10-22T00:00:00.000Z', revokedAt: '2026-10-22T01:00:00.000Z' },
                    { clientId: CLAUDE, clientName: 'Claude', firstSeenAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-20T00:00:00.000Z', revokedAt: null },
                ],
            });
            const bob = await call(base, { headers: as('bob') });
            assert.deepEqual(bob.json.apps.map((app) => app.clientId), [CLAUDE]);
            const select = pool.queries.filter((q) => q.sql.startsWith('select') && q.sql.includes('mcp_oauth_grants'));
            assert.deepEqual(select.map((q) => q.params), [[ALICE], [BOB]], 'the user id comes from the token, never the request');
        });
    });

    it('POST /:clientId/revoke sets revoked_at for the caller only, inserting when needed', async () => {
        await withServer(async (base) => {
            const before = Date.now();
            const revoked = await call(`${base}/${CLAUDE}/revoke`, { method: 'POST', headers: as('alice') });
            assert.equal(revoked.status, 200, revoked.text);
            assert.deepEqual(revoked.json, { ok: true });
            assert.ok(pool.grants.get(`${ALICE}|${CLAUDE}`).revoked_at.getTime() >= before);
            assert.equal(pool.grants.get(`${BOB}|${CLAUDE}`).revoked_at, null, 'Bob keeps his connection');

            const fresh = await call(`${base}/${NEVER_USED.toUpperCase()}/revoke`, { method: 'POST', headers: as('bob') });
            assert.equal(fresh.status, 200);
            assert.ok(pool.grants.get(`${BOB}|${NEVER_USED}`).revoked_at, 'upserted, lower-case id');

            const upsert = pool.queries.find((q) => q.sql.startsWith('insert into mcp_oauth_grants'));
            assert.match(upsert.sql, /on conflict \(user_id, client_id\) do update set revoked_at = now\(\)/);
        });
    });

    it('revoking an app that never called the endpoint records no first or last use, and GET returns them as null', async () => {
        await withServer(async (base) => {
            const revoked = await call(`${base}/${NEVER_USED}/revoke`, { method: 'POST', headers: as('alice') });
            assert.equal(revoked.status, 200, revoked.text);
            const upsert = pool.queries.find((q) => q.sql.startsWith('insert into mcp_oauth_grants'));
            assert.match(upsert.sql, /\(user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at\) values \(cast\(\$1 as uuid\), cast\(\$2 as uuid\), \$3, null, null, now\(\)\)/,
                'the insert writes NULL dates instead of the now() defaults');
            assert.doesNotMatch(upsert.sql.split('on conflict')[1], /first_seen_at|last_used_at/, 'a revoke never changes the dates of a used app');

            const list = await call(base, { headers: as('alice') });
            const app = list.json.apps.find((a) => a.clientId === NEVER_USED);
            assert.equal(app.firstSeenAt, null);
            assert.equal(app.lastUsedAt, null);
            assert.ok(app.revokedAt);
            const used = list.json.apps.find((a) => a.clientId === CODEX);
            assert.equal(used.firstSeenAt, '2026-10-02T00:00:00.000Z', 'a used app keeps its dates');
            const select = pool.queries.find((q) => q.sql.startsWith('select client_id'));
            assert.match(select.sql, /order by coalesce\(last_used_at, revoked_at\) desc nulls last, client_id/, 'never-used rows are not listed first');
        });
    });

    it('the revoke body may carry the app name: trimmed, control characters removed, at most 100 characters', async () => {
        await withServer(async (base) => {
            const post = (clientId, body, who = 'alice') => call(`${base}/${clientId}/revoke`, { method: 'POST', headers: as(who), body });
            assert.equal((await post(NEVER_USED, { clientName: '  My\n\tAgent\u0007\u202e  ' })).status, 200);
            assert.equal(pool.grants.get(`${ALICE}|${NEVER_USED}`).client_name, 'My Agent');

            assert.equal((await post(CLAUDE, { clientName: 'x'.repeat(150) })).status, 200);
            assert.equal(pool.grants.get(`${ALICE}|${CLAUDE}`).client_name, 'x'.repeat(100));

            // The second POST after revokeGrant may carry no name: the stored one is kept.
            assert.equal((await post(CLAUDE, undefined)).status, 200);
            assert.equal((await post(CLAUDE, { clientName: 42 })).status, 200);
            assert.equal((await post(CLAUDE, { clientName: ' \u0000 ' })).status, 200);
            assert.equal(pool.grants.get(`${ALICE}|${CLAUDE}`).client_name, 'x'.repeat(100));
            const upserts = pool.queries.filter((q) => q.sql.startsWith('insert into mcp_oauth_grants'));
            assert.deepEqual(upserts.map((q) => q.params[2]), ['My Agent', 'x'.repeat(100), null, null, null]);
            assert.match(upserts[0].sql, /client_name = coalesce\(excluded\.client_name, mcp_oauth_grants\.client_name\)/);

            const list = await call(base, { headers: as('alice') });
            assert.equal(list.json.apps.find((a) => a.clientId === NEVER_USED).clientName, 'My Agent');
        });
    });

    it('a second revoke POST (after revokeGrant) moves revoked_at forward', async () => {
        await withServer(async (base) => {
            await call(`${base}/${CLAUDE}/revoke`, { method: 'POST', headers: as('alice') });
            const first = pool.grants.get(`${ALICE}|${CLAUDE}`).revoked_at;
            await new Promise((resolve) => { setTimeout(resolve, 5); });
            await call(`${base}/${CLAUDE}/revoke`, { method: 'POST', headers: as('alice') });
            assert.ok(pool.grants.get(`${ALICE}|${CLAUDE}`).revoked_at > first);
        });
    });

    it('POST with a clientId that is not a UUID answers 400 before any query', async () => {
        await withServer(async (base) => {
            for (const id of ['not-a-uuid', '1', `${CLAUDE}x`]) {
                const bad = await call(`${base}/${id}/revoke`, { method: 'POST', headers: as('alice') });
                assert.equal(bad.status, 400, id);
                assert.equal(bad.json.error_type, 'invalid_client_id');
            }
            assert.equal(pool.queries.filter((q) => q.sql.includes('mcp_oauth_grants')).length, 0);
        });
    });

    it('an agent\'s OAuth token, or no token, cannot list or revoke', async () => {
        await withServer(async (base) => {
            for (const [method, url] of [['GET', base], ['POST', `${base}/${CLAUDE}/revoke`]]) {
                const agent = await call(url, { method, headers: as('aliceAgent') });
                assert.equal(agent.status, 401, `${method} agent`);
                assert.equal(agent.json.error_type, 'oauth_client_token');
                assert.equal((await call(url, { method })).status, 401, `${method} anonymous`);
            }
            assert.equal(pool.queries.filter((q) => q.sql.includes('mcp_oauth_grants')).length, 0);
            assert.equal(pool.grants.get(`${ALICE}|${CLAUDE}`).revoked_at, null);
        });
    });

    it('a database failure answers 503 connected_apps_unavailable without the driver text', async () => {
        pool.fail();
        await withServer(async (base) => {
            const originalError = console.error;
            console.error = () => {};
            try {
                for (const [method, url] of [['GET', base], ['POST', `${base}/${CLAUDE}/revoke`]]) {
                    const failed = await call(url, { method, headers: as('alice') });
                    assert.equal(failed.status, 503, method);
                    assert.equal(failed.json.error_type, 'connected_apps_unavailable');
                    assert.doesNotMatch(failed.text, /relation|mcp_oauth_grants/);
                }
            } finally {
                console.error = originalError;
            }
        });
    });

    it('without a database configured it answers 503', async () => {
        setPoolForTests(null);
        await withServer(async (base) => {
            const response = await call(base, { headers: as('alice') });
            assert.equal(response.status, 503);
            assert.equal(response.json.error_type, 'connected_apps_unavailable');
        });
    });
});

describe('015_mcp_oauth_grants.sql', () => {
    it('keys grants by user and client and cascades on account deletion', () => {
        const sql = lower(readFileSync(new URL('../migrations/015_mcp_oauth_grants.sql', import.meta.url), 'utf8')
            .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n'));
        assert.match(sql, /create table if not exists mcp_oauth_grants/);
        assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
        assert.match(sql, /client_id uuid not null/);
        assert.match(sql, /client_name text null/);
        // Nullable: a row inserted by a revoke of an app that never called the endpoint has no use.
        assert.match(sql, /first_seen_at timestamptz null default now\(\)/);
        assert.match(sql, /last_used_at timestamptz null default now\(\)/);
        assert.match(sql, /alter table mcp_oauth_grants alter column first_seen_at drop not null;/);
        assert.match(sql, /alter table mcp_oauth_grants alter column last_used_at drop not null;/);
        assert.match(sql, /revoked_at timestamptz null/);
        assert.match(sql, /primary key \(user_id, client_id\)/);
    });
});
