// The remote MCP endpoint end to end, in process (mcp-server/remote.js + createMcpServer with the
// learner-remote profile and mcp-server/remotePolicy.js): a fake Supabase on 127.0.0.1 serves the
// JWKS, a fake pg pool answers the AI access, grants and tool queries, and the MCP SDK Client talks
// to it over StreamableHTTPClientTransport.
// - 401 with WWW-Authenticate resource_metadata, Protected Resource Metadata, expired and bad tokens
//   (never a 500, never a Supabase /user call), a revoked app;
// - adults only on every tools/call, resources/read and prompts/get (minor, no age, lookup failure),
//   while initialize and the list methods work;
// - only the learner-remote tools, without rp_turn or user_id; daily caps; per-minute limits;
// - Host and Origin checks, GET/DELETE 405, /health; the token never in results or logs.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverOAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { createDailyCaps } from '../middleware/dailyCaps.js';
import { createOAuthVerifier } from '../../mcp-server/oauthVerifier.js';
import { createRemoteApp, readRemoteConfig } from '../../mcp-server/remote.js';
import { createRemotePolicy } from '../../mcp-server/remotePolicy.js';
import { createMcpServer, REMOTE_ACCESS_REFUSED, REMOTE_RAG_MAX_RESULTS, remoteRagResults } from '../../mcp-server/createMcpServer.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';
import { startFakeSupabase } from './helpers/fakeSupabase.js';

const ADULT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const ADULT_2 = 'a2a2a2a2-0000-4000-8000-0000000000a2';
const MINOR = 'b1b1b1b1-0000-4000-8000-0000000000b1';
const NO_AGE = 'c3c3c3c3-0000-4000-8000-0000000000c3';
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000001';
const REMOTE_TOOLS = ['journal-log', 'journal-recent', 'learner-adaptation-signals', 'learner-state-get', 'learner-state-update', 'rag-search'];
const ALLOWED_ORIGIN = 'https://inspector.example.org';

/** Everything the endpoint logs while these tests run (checked for the token at the end). */
const logs = [];
const capture = (...args) => logs.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
const logger = { log: capture, warn: capture, error: capture };

/** Fake pool: AI access (helpers/aiAccessPool.js) plus grants and the learner-remote tools. */
function remotePool() {
    const grants = new Map();
    const state = { failAccess: false, revoked: new Map() };
    const pool = createAiAccessPool({
        ages: { [ADULT]: '1990-01', [ADULT_2]: '1985-06', [MINOR]: '2012-05' },
        fail: (sql) => state.failAccess && /user_age|account_consents|ai_safety_events/.test(sql),
        answer: (sql, params) => {
            if (sql.startsWith('select 1 from mcp_oauth_grants')) {
                const at = state.revoked.get(`${params[0]}|${params[1]}`);
                return { rows: at !== undefined && at > params[2] ? [{}] : [] };
            }
            if (sql.startsWith('insert into mcp_oauth_grants')) {
                grants.set(`${params[0]}|${params[1]}`, { touched: true });
                return { rowCount: 1, rows: [] };
            }
            if (sql.startsWith('select course_id, completed_stages')) {
                return { rows: [{ course_id: 'vibe-coding', completed_stages: [1], completed_steps: {} }] };
            }
            if (sql.startsWith('select completed_stages, completed_steps from user_progress')) return { rowCount: 0, rows: [] };
            if (sql.startsWith('insert into user_progress')) return { rowCount: 1, rows: [] };
            return undefined;
        },
    });
    return { pool, grants, state };
}

/** A raw HTTP request (custom Host allowed). */
function raw(port, { method = 'GET', path = '/mcp', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
            let text = '';
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(text); } catch { /* not JSON */ }
                resolve({ status: res.statusCode, headers: res.headers, text, json });
            });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });
}

const INIT = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
};
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

/** Start the endpoint on a free port; the resource URL carries that port. */
async function startEndpoint({ fake, env = {}, limits, capsEnv = {} }) {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const config = readRemoteConfig({
        MCP_REMOTE_TEST: '1',
        MCP_PUBLIC_RESOURCE_URL: `http://127.0.0.1:${port}/mcp`,
        SUPABASE_URL: fake.url,
        SUPABASE_ANON_KEY: 'anon-key-for-tests',
        MCP_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
        ...env,
    });
    const supabase = createClient(fake.url, 'anon-key-for-tests', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const verifier = createOAuthVerifier({ issuer: config.issuer, resource: config.resource, supabase, logger });
    const caps = createDailyCaps({ env: capsEnv, getPool: () => null, logger });
    const policy = createRemotePolicy({ env: { APP_PUBLIC_URL: 'https://app.example.org' }, reserveCap: caps.reserveFor });
    const app = createRemoteApp({
        config,
        verifier,
        logger,
        limits: limits ?? { userPerMinute: 1000, unauthenticatedPerMinute: 1000 },
        createServer: () => createMcpServer({ profile: 'learner-remote', remote: policy }),
    });
    server.on('request', app);
    return { port, resource: config.resource, config, close: () => new Promise((resolve) => server.close(resolve)) };
}

const parse = (result) => JSON.parse(result.content[0].text);

describe('remote MCP endpoint (in process)', () => {
    let fake;
    let endpoint;
    let db;
    const savedConsole = { log: console.log, warn: console.warn, error: console.error };
    const tokens = [];
    const tokenFor = (sub, overrides, signOptions, clientId = CLIENT) => {
        const t = fake.accessToken({ resource: endpoint.resource, sub, clientId }, overrides, signOptions);
        tokens.push(t);
        return t;
    };
    const clients = [];
    const connect = async (token) => {
        const client = new Client({ name: 'remote-test', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(endpoint.resource), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
        });
        await client.connect(transport);
        clients.push(client);
        return client;
    };

    before(async () => {
        console.log = capture;
        console.warn = capture;
        console.error = capture;
        fake = await startFakeSupabase();
        endpoint = await startEndpoint({ fake, capsEnv: { AI_CAP_USER_MCP: '6', AI_CAP_USER_MCP_WRITE: '2' } });
    });

    after(async () => {
        for (const client of clients) await client.close().catch(() => {});
        await endpoint.close();
        await fake.close();
        resetPoolForTests();
        resetAiAccessForTests();
        Object.assign(console, savedConsole);
    });

    beforeEach(() => {
        db = remotePool();
        setPoolForTests(db.pool);
        resetAiAccessForTests();
        fake.resetCalls();
    });

    it('no token: 401 with WWW-Authenticate Bearer resource_metadata', async () => {
        const res = await raw(endpoint.port, { method: 'POST', headers: MCP_HEADERS, body: INIT });
        assert.equal(res.status, 401);
        const prmUrl = `http://127.0.0.1:${endpoint.port}/.well-known/oauth-protected-resource/mcp`;
        assert.match(res.headers['www-authenticate'], /^Bearer /);
        assert.match(res.headers['www-authenticate'], new RegExp(`resource_metadata="${prmUrl.replace(/[.]/g, '\\.')}"`));
        assert.equal(res.json.error, 'invalid_token');
    });

    it('serves the Protected Resource Metadata at the RFC 9728 path and the root path', async () => {
        const expected = {
            resource: endpoint.resource,
            authorization_servers: [`${fake.url}/auth/v1`],
            bearer_methods_supported: ['header'],
            resource_name: 'Rise Path',
        };
        for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
            const res = await raw(endpoint.port, { path });
            assert.equal(res.status, 200, path);
            assert.deepEqual(res.json, expected, path);
        }
        const discovered = await discoverOAuthProtectedResourceMetadata(new URL(endpoint.resource));
        assert.equal(discovered.resource, endpoint.resource);
        assert.deepEqual(discovered.authorization_servers, [`${fake.url}/auth/v1`]);
        assert.equal(discovered.scopes_supported, undefined, 'no custom scopes');
    });

    it('expired token: 401 with a challenge, not 500', async () => {
        const now = Math.floor(Date.now() / 1000);
        const res = await raw(endpoint.port, {
            method: 'POST',
            headers: { ...MCP_HEADERS, authorization: `Bearer ${tokenFor(ADULT, { exp: now - 5, iat: now - 3605 })}` },
            body: INIT,
        });
        assert.equal(res.status, 401);
        assert.match(res.headers['www-authenticate'], /error="invalid_token"/);
        assert.match(res.headers['www-authenticate'], /resource_metadata=/);
    });

    it('wrong aud, no client_id, HS256, unknown kid: 401, and Supabase /user is never called', async () => {
        const now = Math.floor(Date.now() / 1000);
        const bad = [
            tokenFor(ADULT, { aud: 'authenticated' }),
            tokenFor(ADULT, { client_id: null }),
            tokenFor(ADULT, {}, { alg: 'HS256' }),
            tokenFor(ADULT, {}, { key: (await import('./helpers/fakeSupabase.js')).makeEs256Key('nope') }),
            tokenFor(ADULT, { iat: now, exp: now + 60, aud: endpoint.resource, iss: 'https://evil.example/auth/v1' }),
        ];
        for (const token of bad) {
            const res = await raw(endpoint.port, { method: 'POST', headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, body: INIT });
            assert.equal(res.status, 401);
            assert.match(res.headers['www-authenticate'], /resource_metadata=/);
        }
        assert.equal(fake.calls.user, 0, 'no /auth/v1/user call');
        assert.ok(fake.calls.jwks <= 1, 'at most the one throttled JWKS refetch for the unknown kid');
    });

    it('a revoked app: 401 for tokens issued before the revoke', async () => {
        const now = Math.floor(Date.now() / 1000);
        db.state.revoked.set(`${ADULT}|${CLIENT}`, now - 1);
        const res = await raw(endpoint.port, {
            method: 'POST',
            headers: { ...MCP_HEADERS, authorization: `Bearer ${tokenFor(ADULT, { iat: now - 30 })}` },
            body: INIT,
        });
        assert.equal(res.status, 401);
        assert.match(res.headers['www-authenticate'], /invalid_token/);
    });

    it('adult: tools/list shows only the learner-remote tools, without rp_turn or user_id', async () => {
        const client = await connect(tokenFor(ADULT));
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((t) => t.name).sort(), REMOTE_TOOLS);
        for (const tool of tools) {
            const props = Object.keys(tool.inputSchema.properties ?? {});
            assert.ok(!props.includes('rp_turn'), tool.name);
            assert.ok(!props.includes('user_id'), tool.name);
        }
        const rag = tools.find((t) => t.name === 'rag-search');
        assert.match(rag.inputSchema.properties.max_results.description, new RegExp(`1-${REMOTE_RAG_MAX_RESULTS}`));
        const { resources } = await client.listResources();
        assert.deepEqual(resources.map((r) => r.uri), ['content://domains'], 'no learner://profile/me');
        const { prompts } = await client.listPrompts();
        assert.deepEqual(prompts.map((p) => p.name), ['socratic-tutor'], 'no author-lesson');
    });

    it('adult: a call works as the token user, records the connected app, and the token stays out of the result', async () => {
        const otherClient = 'c2c2c2c2-0000-4000-8000-000000000002';
        const token = tokenFor(ADULT, {}, {}, otherClient);
        const client = await connect(token);
        const result = await client.callTool({ name: 'learner-state-get', arguments: {} });
        assert.ok(!result.isError, result.content[0].text);
        assert.ok(Array.isArray(parse(result).progress) || typeof parse(result) === 'object');
        const progressQuery = db.pool.queries.find((q) => q.sql.startsWith('select course_id, completed_stages'));
        assert.equal(progressQuery.params[0], ADULT, 'scoped to the token user');
        const touches = db.pool.queries.filter((q) => q.sql.startsWith('insert into mcp_oauth_grants'));
        assert.equal(touches.length, 1, 'mcp_oauth_grants upserted once (last_used_at at most once a minute)');
        assert.deepEqual(touches[0].params.slice(0, 2), [ADULT, otherClient]);
        assert.match(touches[0].sql, /^insert into mcp_oauth_grants \(user_id, client_id\) values \(\$1, \$2\)/, 'a new row takes both dates from the column defaults');
        assert.match(touches[0].sql, /on conflict \(user_id, client_id\) do update set first_seen_at = coalesce\(mcp_oauth_grants\.first_seen_at, now\(\)\), last_used_at = now\(\)/,
            'a revoke-only row (first_seen_at NULL) gets its first use; an existing first use is kept');
        assert.doesNotMatch(touches[0].sql, /revoked_at/, 'the endpoint never clears or sets revoked_at');
        assert.doesNotMatch(touches[0].sql, /client_name/, 'the endpoint never writes client_name');
        assert.equal(touches[0].params.length, 2);
        assert.ok(!JSON.stringify(result).includes(token));
        const domains = await client.readResource({ uri: 'content://domains' });
        assert.match(domains.contents[0].text, /vibe-coding/);
        const prompt = await client.getPrompt({ name: 'socratic-tutor', arguments: { topic: 'loops' } });
        assert.match(prompt.messages[0].content.text, /loops/);
    });

    it('an LLM-supplied user_id or rp_turn cannot change the learner', async () => {
        const client = await connect(tokenFor(ADULT));
        const result = await client.callTool({ name: 'learner-state-get', arguments: { user_id: MINOR, rp_turn: 'Zm9yZ2VkLXR1cm4tdG9rZW4tMTIzNDU2' } });
        assert.ok(!result.isError, result.content[0].text);
        const q = db.pool.queries.find((x) => x.sql.startsWith('select course_id, completed_stages'));
        assert.equal(q.params[0], ADULT);
    });

    it('learner-state-update accepts only known domains', async () => {
        const client = await connect(tokenFor(ADULT_2));
        const bad = await client.callTool({ name: 'learner-state-update', arguments: { domain: 'anything', lesson_id: 'x' } });
        assert.equal(bad.isError, true);
        assert.equal(parse(bad).error_type, 'invalid_domain');
        const good = await client.callTool({ name: 'learner-state-update', arguments: { domain: 'vibe-coding', lesson_id: 'vibe-ch1' } });
        assert.ok(!good.isError, good.content[0].text);
    });

    it('daily caps: mcp_write after 2 writes, mcp after 6 calls, as daily_limit_reached tool errors', async () => {
        const user = 'd4d4d4d4-0000-4000-8000-0000000000d4';
        db.pool.ages[user] = '1980-02';
        const client = await connect(tokenFor(user));
        const write = () => client.callTool({ name: 'learner-state-update', arguments: { domain: 'vibe-coding', lesson_id: 'vibe-ch1' } });
        assert.ok(!(await write()).isError);
        assert.ok(!(await write()).isError);
        const third = await write();
        assert.equal(third.isError, true);
        assert.equal(parse(third).error_type, 'daily_limit_reached');
        assert.equal(parse(third).kind, 'mcp_write');
        assert.match(parse(third).error, /0 時/);
        // 3 calls charged to 'mcp' so far (the refused write gave its 'mcp' slot back).
        for (let i = 0; i < 4; i += 1) assert.ok(!(await client.callTool({ name: 'learner-state-get', arguments: {} })).isError, `read ${i}`);
        const over = await client.callTool({ name: 'learner-state-get', arguments: {} });
        assert.equal(parse(over).error_type, 'daily_limit_reached');
        assert.equal(parse(over).kind, 'mcp');
    });

    for (const [label, user, errorType] of [['a minor', MINOR, 'adults_only'], ['a learner with no age', NO_AGE, 'age_required']]) {
        it(`${label}: initialize and lists work; every call, read and prompt is refused (${errorType})`, async () => {
            const client = await connect(tokenFor(user));
            const { tools } = await client.listTools();
            assert.equal(tools.length, REMOTE_TOOLS.length);
            for (const name of ['learner-state-get', 'journal-recent', 'rag-search']) {
                const result = await client.callTool({ name, arguments: name === 'rag-search' ? { query: 'x' } : {} });
                assert.equal(result.isError, true, name);
                const body = parse(result);
                assert.equal(body.error_type, errorType, name);
                assert.equal(body.settings_url, 'https://app.example.org/settings/ai-access');
                assert.ok(body.message.en && body.message.jp);
            }
            assert.equal(db.pool.queries.filter((q) => q.sql.startsWith('select course_id')).length, 0, 'no tool ran');
            // One 'MCP error <code>: ' prefix (the client's), a server-defined code, not -32600.
            const text = parse(await client.callTool({ name: 'learner-state-get', arguments: {} })).error;
            const refused = (error) => error.code === REMOTE_ACCESS_REFUSED
                && error.message === `MCP error ${REMOTE_ACCESS_REFUSED}: ${text}`
                && error.data?.error_type === errorType;
            await assert.rejects(client.readResource({ uri: 'content://domains' }), refused);
            await assert.rejects(client.getPrompt({ name: 'socratic-tutor', arguments: { topic: 't' } }), refused);
        });
    }

    it('an access lookup that fails refuses (ai_access_unavailable)', async () => {
        db.state.failAccess = true;
        const client = await connect(tokenFor(ADULT));
        const result = await client.callTool({ name: 'learner-state-get', arguments: {} });
        assert.equal(parse(result).error_type, 'ai_access_unavailable');
    });

    it('Host: only the resource host (403 otherwise); /health answers any Host with status only', async () => {
        const bad = await raw(endpoint.port, { method: 'POST', headers: { ...MCP_HEADERS, host: 'evil.example' }, body: INIT });
        assert.equal(bad.status, 403);
        const prm = await raw(endpoint.port, { path: '/.well-known/oauth-protected-resource/mcp', headers: { host: 'evil.example' } });
        assert.equal(prm.status, 403);
        const health = await raw(endpoint.port, { path: '/health', headers: { host: 'evil.example' } });
        assert.equal(health.status, 200);
        assert.deepEqual(health.json, { status: 'ok' });
    });

    it('Origin: an unknown one is 403; an allowed one gets CORS that exposes WWW-Authenticate', async () => {
        const bad = await raw(endpoint.port, { method: 'POST', headers: { ...MCP_HEADERS, origin: 'https://evil.example' }, body: INIT });
        assert.equal(bad.status, 403);
        assert.equal(bad.headers['access-control-allow-origin'], undefined);
        const preflight = await raw(endpoint.port, { method: 'OPTIONS', headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'POST' } });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
        assert.match(preflight.headers['access-control-allow-headers'], /Authorization/);
        assert.match(preflight.headers['access-control-allow-headers'], /Mcp-Protocol-Version/);
        const unauth = await raw(endpoint.port, { method: 'POST', headers: { ...MCP_HEADERS, origin: ALLOWED_ORIGIN }, body: INIT });
        assert.equal(unauth.status, 401);
        assert.match(unauth.headers['access-control-expose-headers'], /WWW-Authenticate/);
    });

    it('GET and DELETE /mcp: 405', async () => {
        const token = tokenFor(ADULT);
        for (const method of ['GET', 'DELETE']) {
            const res = await raw(endpoint.port, { method, headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' } });
            assert.equal(res.status, 405, method);
            assert.equal(res.headers.allow, 'POST');
        }
    });

    it('a JSON-RPC batch of more than 10 messages is refused before any tool runs', async () => {
        const token = tokenFor(ADULT);
        const batch = Array.from({ length: 11 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: 'learner-state-get', arguments: {} } }));
        const res = await raw(endpoint.port, { method: 'POST', headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, body: batch });
        assert.equal(res.status, 400);
        assert.equal(db.pool.queries.filter((q) => q.sql.startsWith('select course_id')).length, 0);
    });

    it('readRemoteConfig: canonical resource, origins, test-mode binding', () => {
        const base = { MCP_REMOTE_TEST: '1', SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'k' };
        const config = readRemoteConfig({ ...base, MCP_PUBLIC_RESOURCE_URL: 'http://127.0.0.1:9/mcp' });
        assert.equal(config.host, '127.0.0.1');
        assert.equal(config.port, 3200);
        assert.equal(config.issuer, 'http://127.0.0.1:9/auth/v1');
        assert.throws(() => readRemoteConfig({ ...base, MCP_PUBLIC_RESOURCE_URL: 'HTTP://127.0.0.1:9/mcp' }), /canonically/);
        assert.throws(() => readRemoteConfig({ ...base, MCP_PUBLIC_RESOURCE_URL: 'http://127.0.0.1:9/m:cp' }), /path may use only/);
        assert.throws(() => readRemoteConfig({ ...base, MCP_PUBLIC_RESOURCE_URL: 'http://evil.example/mcp' }), /must use https/, 'http only on loopback, even in test mode');
        assert.throws(() => readRemoteConfig({ ...base, MCP_REMOTE_TEST: undefined, NODE_ENV: 'development', MCP_PUBLIC_RESOURCE_URL: 'https://mcp.example.org/mcp' }), /NODE_ENV=production/);
        const prod = readRemoteConfig({ NODE_ENV: 'production', SUPABASE_URL: 'https://ref.supabase.co/', SUPABASE_ANON_KEY: 'k', MCP_PUBLIC_RESOURCE_URL: 'https://mcp.example.org/mcp', MCP_ALLOWED_ORIGINS: 'https://a.example, https://b.example:8443' });
        assert.equal(prod.host, '0.0.0.0');
        assert.equal(prod.issuer, 'https://ref.supabase.co/auth/v1');
        assert.deepEqual([...prod.allowedOrigins], ['https://a.example', 'https://b.example:8443']);
    });

    it('rag-search asks for at most 5 results', () => {
        assert.equal(remoteRagResults(50), REMOTE_RAG_MAX_RESULTS);
        assert.equal(remoteRagResults(2), 2);
        assert.equal(remoteRagResults(undefined), 3);
        assert.equal(remoteRagResults('x'), 3);
    });

    it('per-minute limits: 30 unauthenticated per address, 60 per user and client (here 2 and 3)', async () => {
        const small = await startEndpoint({ fake, limits: { unauthenticatedPerMinute: 2, userPerMinute: 3 } });
        try {
            const unauth = [];
            for (let i = 0; i < 3; i += 1) unauth.push((await raw(small.port, { method: 'POST', headers: MCP_HEADERS, body: INIT })).status);
            assert.deepEqual(unauth, [401, 401, 429]);
            const token = fake.accessToken({ resource: small.resource, sub: ADULT, clientId: CLIENT });
            tokens.push(token);
            const authed = [];
            for (let i = 0; i < 4; i += 1) {
                authed.push((await raw(small.port, { method: 'POST', headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, body: INIT })).status);
            }
            assert.deepEqual(authed, [200, 200, 200, 429], 'authenticated calls are not blocked by the address limit, only by their own');
        } finally {
            await small.close();
        }
    });

    it('no access token appears in any log line', () => {
        const text = logs.join('\n');
        assert.ok(tokens.length > 5);
        for (const t of tokens) {
            assert.ok(!text.includes(t), 'token logged');
            assert.ok(!text.includes(t.split('.')[2]), 'signature logged');
        }
    });
});

describe('remote daily-cap refusal text follows the scope', () => {
    const quiet = { log: () => {}, warn: () => {}, error: () => {} };
    const policyWith = (capsEnv) => createRemotePolicy({
        env: {},
        reserveCap: createDailyCaps({ env: capsEnv, getPool: () => null, logger: quiet }).reserveFor,
    });

    it("'user': the learner's own limit, resets at 00:00 JST", async () => {
        const policy = policyWith({ AI_CAP_USER_MCP: '1' });
        assert.equal(await policy.charge(ADULT, 'learner-state-get'), null);
        const refusal = await policy.charge(ADULT, 'learner-state-get');
        assert.equal(refusal.scope, 'user');
        assert.ok(refusal.reset_at);
        assert.match(refusal.message.en, /^Today's limit for connected AI agents has been reached\. It resets at 00:00/);
        assert.match(refusal.message.jp, /今日の利用上限に達しました。日本時間の 0 時/);
    });

    it("'global': the limit shared by every connected agent, resets at 00:00 JST", async () => {
        const policy = policyWith({ AI_CAP_GLOBAL_MCP: '1' });
        assert.equal(await policy.charge(ADULT, 'learner-state-get'), null);
        const refusal = await policy.charge(ADULT_2, 'learner-state-get');
        assert.equal(refusal.error_type, 'daily_limit_reached');
        assert.equal(refusal.scope, 'global');
        assert.match(refusal.message.en, /shared by all connected AI agents on Rise Path has been used up\. It resets at 00:00/);
        assert.match(refusal.message.jp, /Rise Path 全体で/);
        assert.match(refusal.error, /日本時間の 0 時/);
    });

    it("'off': the remote tools are turned off, with no reset time", async () => {
        const refusal = await policyWith({ AI_CAP_USER_MCP: '0' }).charge(ADULT, 'learner-state-get');
        assert.equal(refusal.error_type, 'daily_limit_reached');
        assert.equal(refusal.scope, 'off');
        assert.equal(refusal.reset_at, undefined);
        assert.equal(refusal.message.en, 'Connected AI agents are turned off on Rise Path for now.');
        assert.doesNotMatch(refusal.error, /00:00|0 時|reset|リセット/);
    });
});
