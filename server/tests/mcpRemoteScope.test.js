// Building blocks of the remote MCP endpoint:
// - tools/core/mcpUserScope.js step 0: the OAuth token's user, before the session map, the rp_turn
//   argument and header, the operator key and the dev fallback; fail closed without it;
// - tools/core/mcpAiAccess.js: adults only for a userId, production rules on the remote endpoint,
//   and the outside-AI draft gate cannot fail open for an OAuth caller;
// - server/middleware/dailyCaps.js reserveFor: the Express-free core, the mcp kinds without a
//   per-address cap;
// - the SSE endpoint (mcp-server/index.js --sse) refuses a connected agent's OAuth token before
//   asking Supabase.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMcpUserId, registerAgentTurn, clearMcpUserScopeForTests, oauthUserId } from '../../tools/core/mcpUserScope.js';
import { adultDraftRefusal, aiAccessRefusal, aiAccessSettingsUrl, remoteAccessEnv } from '../../tools/core/mcpAiAccess.js';
import { createDailyCaps, CAP_KINDS, resolveCapLimits } from '../middleware/dailyCaps.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';
import { startFakeSupabase } from './helpers/fakeSupabase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADULT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const OTHER = 'b2b2b2b2-0000-4000-8000-0000000000b2';
const MINOR = 'c3c3c3c3-0000-4000-8000-0000000000c3';
const PHASE1 = '00000000-0000-0000-0000-000000000001';
const oauthExtra = (userId, more = {}) => ({ authInfo: { token: 'x', clientId: 'c', scopes: [], expiresAt: 0, extra: { userId } }, ...more });

describe('resolveMcpUserId step 0 (remote OAuth)', () => {
    const saved = { ...process.env };
    beforeEach(() => {
        clearMcpUserScopeForTests();
        resetPoolForTests();
        process.env.NODE_ENV = 'development';
        delete process.env.RISEPATH_STRICT_AUTH;
    });
    afterEach(() => {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
        clearMcpUserScopeForTests();
    });

    it('acts for the token user, ignoring the session map, rp_turn (argument and header) and the operator key', async () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${OTHER}`;
        const turn = await registerAgentTurn(OTHER);
        const extra = oauthExtra(ADULT, {
            sessionId: 's1',
            requestInfo: { headers: { 'x-hermes-session-key': `rp:turn:${turn}` } },
        });
        const sessions = new Map([['s1', { userId: OTHER }]]);
        assert.deepEqual(await resolveMcpUserId({ extra, sessions, turnToken: turn, remote: true }), { userId: ADULT });
        assert.deepEqual(await resolveMcpUserId({ extra, sessions, turnToken: turn }), { userId: ADULT }, 'authInfo alone selects step 0');
    });

    it('a remote call without a verified user fails closed, even in development (never PHASE1, never the operator key)', async () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${OTHER}`;
        for (const extra of [{}, { authInfo: { extra: {} } }, oauthExtra('not-a-uuid'), oauthExtra(42)]) {
            const result = await resolveMcpUserId({ extra, remote: true });
            assert.equal(result.error_type, 'session_binding_required', JSON.stringify(extra));
            assert.ok(!('userId' in result));
        }
        assert.deepEqual(await resolveMcpUserId({ extra: {} }), { userId: OTHER }, 'stdio keeps the operator key');
        delete process.env.RISE_PATH_ACTIVE_SESSION_KEY;
        assert.deepEqual(await resolveMcpUserId({ extra: {} }), { userId: PHASE1 }, 'stdio dev fallback unchanged');
    });

    it('oauthUserId accepts only a UUID', () => {
        assert.equal(oauthUserId(oauthExtra(ADULT)), ADULT);
        assert.equal(oauthUserId(oauthExtra('x')), null);
        assert.equal(oauthUserId({}), null);
    });
});

describe('adults only for a userId (remote rules)', () => {
    beforeEach(() => {
        resetAiAccessForTests();
        setPoolForTests(createAiAccessPool({ ages: { [ADULT]: '1990-01', [MINOR]: '2013-03' } }));
        console.error = () => {};
    });
    const savedError = console.error;
    afterEach(() => {
        console.error = savedError;
        resetPoolForTests();
        resetAiAccessForTests();
    });

    it('ready adult: null; minor: adults_only; no age: age_required; with EN + JP text and the settings link', async () => {
        const settingsUrl = aiAccessSettingsUrl({ APP_PUBLIC_URL: 'https://app.example.org/some/path' });
        assert.equal(settingsUrl, 'https://app.example.org/settings/ai-access');
        assert.equal(await aiAccessRefusal(ADULT, { env: remoteAccessEnv({}), settingsUrl }), null);
        const minor = await aiAccessRefusal(MINOR, { env: remoteAccessEnv({}), settingsUrl });
        assert.equal(minor.error_type, 'adults_only');
        assert.match(minor.error, /18/);
        assert.match(minor.message.jp, /18 歳以上/);
        assert.equal(minor.settings_url, settingsUrl);
        assert.equal((await aiAccessRefusal(OTHER, { env: remoteAccessEnv({}) })).error_type, 'age_required');
        assert.equal(aiAccessSettingsUrl({ APP_PUBLIC_URL: 'javascript:alert(1)' }), null);
        assert.equal(aiAccessSettingsUrl({}), null);
    });

    it('remote rules ignore AI_ACCESS_DEV_AUDIENCE and treat no database as unavailable', async () => {
        const env = remoteAccessEnv({ NODE_ENV: 'development', AI_ACCESS_DEV_AUDIENCE: 'adult' });
        assert.equal(env.NODE_ENV, 'production');
        assert.equal(env.AI_ACCESS_DEV_AUDIENCE, undefined);
        assert.equal((await aiAccessRefusal(MINOR, { env })).error_type, 'adults_only');
        resetPoolForTests();
        setPoolForTests(null);
        assert.equal((await aiAccessRefusal(ADULT, { env })).error_type, 'ai_access_unavailable');
    });

    it('the outside-AI draft gate checks an OAuth caller (it no longer fails open without an SSE session)', async () => {
        assert.equal((await adultDraftRefusal({ extra: oauthExtra(MINOR), sessions: new Map(), env: { NODE_ENV: 'development' } }))?.error_type, 'adults_only');
        assert.equal(await adultDraftRefusal({ extra: oauthExtra(ADULT), sessions: new Map(), env: { NODE_ENV: 'development' } }), null);
        assert.equal((await adultDraftRefusal({ extra: { authInfo: { extra: {} } }, sessions: new Map() }))?.error_type, 'ai_access_unavailable');
    });
});

describe('dailyCaps reserveFor (no Express) and the mcp kinds', () => {
    it('has mcp and mcp_write without a per-address cap; AI_CAP_IP_MCP is ignored', () => {
        assert.ok(CAP_KINDS.includes('mcp') && CAP_KINDS.includes('mcp_write'));
        const limits = resolveCapLimits({ AI_CAP_IP_MCP: '0', AI_CAP_USER_MCP: '9', AI_CAP_GLOBAL_MCP_WRITE: '7' });
        assert.deepEqual(limits.mcp, { user: 9, ip: null, global: 20000 });
        assert.deepEqual(limits.mcp_write, { user: 50, ip: null, global: 7 });
    });

    it('charges the user and all users, never the address, and refuses with the 429 body', async () => {
        const pool = createAiAccessPool();
        const caps = createDailyCaps({ env: {}, getPool: () => pool, logger: { warn() {}, error() {} } });
        const { handle, refusal } = await caps.reserveFor({ kind: 'mcp', userId: ADULT, ip: '203.0.113.9' });
        assert.ok(handle && !refusal);
        assert.deepEqual(pool.charged().map((q) => q.params.slice(1, 3)), [['mcp', ADULT], ['mcp', '*']]);

        const memory = createDailyCaps({ env: { AI_CAP_USER_MCP_WRITE: '1' }, getPool: () => null, logger: { warn() {}, error() {} } });
        assert.ok((await memory.reserveFor({ kind: 'mcp_write', userId: ADULT })).handle);
        const second = await memory.reserveFor({ kind: 'mcp_write', userId: ADULT });
        assert.equal(second.refusal.status, 429);
        assert.equal(second.refusal.body.error_type, 'daily_limit_reached');
        assert.equal(second.refusal.body.kind, 'mcp_write');
        assert.equal(second.refusal.body.scope, 'user');
        assert.match(second.refusal.headers['Retry-After'], /^\d+$/);
        assert.ok((await memory.reserveFor({ kind: 'mcp_write', userId: OTHER })).handle, 'another learner is not affected');

        const off = createDailyCaps({ env: { AI_CAP_GLOBAL_MCP: '0' }, getPool: () => null, logger: { warn() {}, error() {} } });
        const refused = await off.reserveFor({ kind: 'mcp', userId: ADULT });
        assert.equal(refused.refusal.body.scope, 'off');
    });
});

describe('SSE endpoint refuses a connected agent\'s OAuth token', () => {
    let fake;
    let child;
    let port;

    before(async () => {
        fake = await startFakeSupabase();
        port = await new Promise((resolve) => {
            const srv = net.createServer();
            srv.listen(0, '127.0.0.1', () => {
                const p = srv.address().port;
                srv.close(() => resolve(p));
            });
        });
        child = spawn(process.execPath, [path.join(ROOT, 'mcp-server/index.js'), '--sse', String(port)], {
            cwd: ROOT,
            env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', SUPABASE_URL: fake.url, SUPABASE_ANON_KEY: 'anon-key-for-tests' },
        });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        const deadline = Date.now() + 20000;
        while (!/running on/.test(out)) {
            if (Date.now() > deadline || child.exitCode !== null) throw new Error(`SSE server did not start:\n${out}`);
            await new Promise((r) => setTimeout(r, 50));
        }
    });

    after(async () => {
        child?.kill('SIGTERM');
        await new Promise((r) => (child?.exitCode !== null ? r() : child.once('exit', r)));
        await fake?.close();
    });

    const getSse = (token) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/sse', headers: { authorization: `Bearer ${token}` } }, (res) => {
            res.resume();
            resolve(res.statusCode);
            req.destroy();
        });
        req.on('error', reject);
        req.end();
    });

    it('401 without asking Supabase for an OAuth client token; a session token still goes to Supabase', async () => {
        fake.resetCalls();
        const agent = fake.accessToken({ resource: 'https://mcp.example.org/mcp', sub: ADULT });
        assert.equal(await getSse(agent), 401);
        assert.equal(fake.calls.user, 0, 'refused before getUser');
        const session = fake.accessToken({ resource: 'x', sub: ADULT }, { aud: 'authenticated', client_id: null });
        assert.equal(await getSse(session), 401, 'the fake refuses every user lookup');
        assert.equal(fake.calls.user, 1, 'a learner session token is still checked with getUser');
    });
});
