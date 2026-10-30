// `node mcp-server/index.js --http` as a child process (the real entry of the mcp-public service):
// - it refuses to start outside production unless MCP_REMOTE_TEST=1, with a non-https resource or
//   issuer in production, or with a profile other than learner-remote;
// - started for tests (127.0.0.1, a fake Supabase, no database): /health, the metadata, 401 with
//   resource_metadata, 405 for GET, the Host check, a bridge token or a learner session token is
//   refused, and a valid token without a database fails closed (503), never as a dev user;
// - RISE_PATH_BRIDGE_TOKEN and RISE_PATH_ACTIVE_SESSION_KEY are ignored, and no token is logged.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSupabase } from './helpers/fakeSupabase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = path.join(ROOT, 'mcp-server/index.js');
const ADULT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const BRIDGE = 'bridge-token-for-tests-0123456789';

const freePort = () => new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
    });
});

/** Only what the child needs: never the runner's DATABASE_URL_PHASE1 or keys. */
const baseEnv = (extra) => ({ PATH: process.env.PATH, HOME: process.env.HOME, ...extra });

/** Run the entry until it exits (or `ms` pass). */
function runToExit(env, args = ['--http'], ms = 15000) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [ENTRY, ...args], { env, cwd: ROOT });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d; });
        child.stdout.on('data', (d) => { stderr += d; });
        const timer = setTimeout(() => child.kill('SIGKILL'), ms);
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code, stderr });
        });
    });
}

function raw(port, { method = 'GET', path: p = '/mcp', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
            let text = '';
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(text); } catch { /* not JSON */ }
                resolve({ status: res.statusCode, headers: res.headers, json, text });
            });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
    });
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } };
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('mcp-server/index.js --http: refuses unsafe configurations', () => {
    const good = {
        MCP_PUBLIC_RESOURCE_URL: 'https://mcp.example.org/mcp',
        SUPABASE_URL: 'https://ref.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        MCP_HTTP_PORT: '3299',
    };

    it('outside production without MCP_REMOTE_TEST', async () => {
        const { code, stderr } = await runToExit(baseEnv({ ...good, NODE_ENV: 'development' }));
        assert.equal(code, 1);
        assert.match(stderr, /NODE_ENV=production/);
    });

    it('in production with an http:// resource or issuer, a trailing slash, or no anon key', async () => {
        const { code, stderr } = await runToExit(baseEnv({
            NODE_ENV: 'production',
            MCP_PUBLIC_RESOURCE_URL: 'http://mcp.example.org/mcp/',
            SUPABASE_URL: 'http://ref.supabase.co',
            MCP_HTTP_PORT: '0',
            MCP_ALLOWED_ORIGINS: 'https://ok.example.org,https://bad.example.org/path',
        }));
        assert.equal(code, 1);
        assert.match(stderr, /MCP_PUBLIC_RESOURCE_URL must use https/);
        assert.match(stderr, /trailing slash/);
        assert.match(stderr, /SUPABASE_URL must use https/);
        assert.match(stderr, /SUPABASE_ANON_KEY is not set/);
        assert.match(stderr, /MCP_HTTP_PORT must be a port number/);
        assert.match(stderr, /"https:\/\/bad\.example\.org\/path" is not an origin/);
    });

    it('with a profile other than learner-remote', async () => {
        const { code, stderr } = await runToExit(baseEnv({ ...good, NODE_ENV: 'production', RISE_PATH_MCP_PROFILE: 'admin' }));
        assert.equal(code, 1);
        assert.match(stderr, /only the learner-remote profile/);
    });
});

describe('mcp-server/index.js --http (MCP_REMOTE_TEST, fake Supabase, no database)', () => {
    let fake;
    let child;
    let port;
    let resource;
    let output = '';
    const tokens = [];

    before(async () => {
        fake = await startFakeSupabase();
        port = await freePort();
        resource = `http://127.0.0.1:${port}/mcp`;
        child = spawn(process.execPath, [ENTRY, '--http'], {
            cwd: ROOT,
            env: baseEnv({
                NODE_ENV: 'test',
                MCP_REMOTE_TEST: '1',
                MCP_PUBLIC_RESOURCE_URL: resource,
                MCP_HTTP_PORT: String(port),
                SUPABASE_URL: fake.url,
                SUPABASE_ANON_KEY: 'anon-key-for-tests',
                RISE_PATH_BRIDGE_TOKEN: BRIDGE,
                RISE_PATH_ACTIVE_SESSION_KEY: `rp:user:${ADULT}`,
                AI_ACCESS_DEV_AUDIENCE: 'adult',
            }),
        });
        child.stderr.on('data', (d) => { output += d; });
        child.stdout.on('data', (d) => { output += d; });
        const deadline = Date.now() + 20000;
        while (!/listening on 127\.0\.0\.1/.test(output)) {
            if (Date.now() > deadline || child.exitCode !== null) throw new Error(`remote entry did not start:\n${output}`);
            await new Promise((r) => setTimeout(r, 50));
        }
    });

    after(async () => {
        child?.kill('SIGTERM');
        await new Promise((r) => (child?.exitCode !== null ? r() : child.once('exit', r)));
        await fake?.close();
    });

    it('binds 127.0.0.1 and says which variables it ignores', () => {
        assert.match(output, /listening on 127\.0\.0\.1:/);
        assert.match(output, /ignoring RISE_PATH_BRIDGE_TOKEN, RISE_PATH_ACTIVE_SESSION_KEY, AI_ACCESS_DEV_AUDIENCE/);
    });

    it('Phase 8: says nothing about the terms check while LEGAL_TERMS_REQUIRED is unset (SG-6)', () => {
        assert.doesNotMatch(output, /terms check|LEGAL_TERMS_REQUIRED/);
    });

    it('/health: status only', async () => {
        const res = await raw(port, { path: '/health', headers: { host: 'anything.example' } });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { status: 'ok' });
    });

    it('serves the metadata and answers 401 with resource_metadata', async () => {
        const prm = await raw(port, { path: '/.well-known/oauth-protected-resource/mcp' });
        assert.deepEqual(prm.json, { resource, authorization_servers: [`${fake.url}/auth/v1`], bearer_methods_supported: ['header'], resource_name: 'Rise Path' });
        const res = await raw(port, { method: 'POST', headers: MCP_HEADERS, body: INIT });
        assert.equal(res.status, 401);
        assert.match(res.headers['www-authenticate'], new RegExp(`resource_metadata="http://127\\.0\\.0\\.1:${port}/\\.well-known/oauth-protected-resource/mcp"`));
    });

    it('GET /mcp is 405; a foreign Host is 403', async () => {
        assert.equal((await raw(port, { method: 'GET', headers: { accept: 'text/event-stream' } })).status, 405);
        assert.equal((await raw(port, { method: 'POST', headers: { ...MCP_HEADERS, host: 'evil.example' }, body: INIT })).status, 403);
    });

    it('the bridge token and a learner session token (aud authenticated, no client_id) are 401', async () => {
        const session = fake.accessToken({ resource, sub: ADULT }, { aud: 'authenticated', client_id: null });
        tokens.push(session);
        for (const token of [BRIDGE, session]) {
            const res = await raw(port, { method: 'POST', headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, body: INIT });
            assert.equal(res.status, 401);
        }
        assert.equal(fake.calls.user, 0);
    });

    it('an expired token is 401, not 500', async () => {
        const now = Math.floor(Date.now() / 1000);
        const token = fake.accessToken({ resource, sub: ADULT }, { exp: now - 1, iat: now - 3601 });
        tokens.push(token);
        const res = await raw(port, { method: 'POST', headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, body: INIT });
        assert.equal(res.status, 401);
    });

    it('a valid token without a database fails closed (503), never a dev user', async () => {
        const token = fake.accessToken({ resource, sub: ADULT });
        tokens.push(token);
        const res = await raw(port, { method: 'POST', headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, body: INIT });
        assert.equal(res.status, 503);
        assert.equal(res.headers['retry-after'], '30');
    });

    it('logs no token', () => {
        for (const t of [...tokens, BRIDGE]) assert.ok(!output.includes(t), 'a token reached the log');
    });
});

describe('mcp-server/index.js --http with LEGAL_TERMS_REQUIRED (Phase 8)', () => {
    let fake;
    const children = [];

    before(async () => {
        fake = await startFakeSupabase();
    });

    after(async () => {
        for (const child of children) {
            child.kill('SIGTERM');
            await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
        }
        await fake?.close();
    });

    /** Start the entry with the switch set, until it listens; its output. */
    const startWith = async (value) => {
        const port = await freePort();
        const child = spawn(process.execPath, [ENTRY, '--http'], {
            cwd: ROOT,
            env: baseEnv({
                NODE_ENV: 'test',
                MCP_REMOTE_TEST: '1',
                MCP_PUBLIC_RESOURCE_URL: `http://127.0.0.1:${port}/mcp`,
                MCP_HTTP_PORT: String(port),
                SUPABASE_URL: fake.url,
                SUPABASE_ANON_KEY: 'anon-key-for-tests',
                LEGAL_TERMS_REQUIRED: value,
            }),
        });
        children.push(child);
        let output = '';
        child.stderr.on('data', (d) => { output += d; });
        child.stdout.on('data', (d) => { output += d; });
        const deadline = Date.now() + 20000;
        while (!/listening on 127\.0\.0\.1/.test(output)) {
            if (Date.now() > deadline || child.exitCode !== null) throw new Error(`remote entry did not start:\n${output}`);
            await new Promise((r) => setTimeout(r, 50));
        }
        return output;
    };

    it('one separate line when it is on or not recognised; the listening line is unchanged', async () => {
        const on = await startWith('true');
        assert.match(on, /^\[MCP remote\] terms check: required \(LEGAL_TERMS_REQUIRED\)/m);
        assert.match(on, /^\[MCP remote\] listening on 127\.0\.0\.1:\d+; resource http:\/\/127\.0\.0\.1:\d+\/mcp; issuer .+; profile learner-remote \(MCP_REMOTE_TEST\)$/m);
        const odd = await startWith('ture');
        assert.match(odd, /^\[MCP remote\] terms check: off: LEGAL_TERMS_REQUIRED has an unrecognised value/m);
        assert.doesNotMatch(odd, /ture/, 'the value is not logged');
        const off = await startWith('false');
        assert.doesNotMatch(off, /terms check/);
    });
});
