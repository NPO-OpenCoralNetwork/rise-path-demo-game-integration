/**
 * Phase 10-5: MCP Server Health & CORS Tests
 *
 * Uses fetch against a pre-started server.
 * Run: MCP_PORT=19999 node mcp-server/index.js --profile admin --sse 19999 &
 *      node --test mcp-server/tests/health.test.js
 *
 * Or simply: npm run test:mcp
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';

const PORT = process.env.MCP_TEST_PORT || 19777;
let serverPid;

function httpGet(urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${PORT}${urlPath}`, { headers }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, headers: res.headers, body }); }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

function httpRequest(method, urlPath, headers = {}, bodyData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(`http://localhost:${PORT}${urlPath}`, { method, headers }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
                catch { resolve({ status: res.statusCode, headers: res.headers, body }); }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
        if (bodyData) req.write(bodyData);
        req.end();
    });
}

// Start server as background process using shell
before(async () => {
    try {
        // Check if already running
        await httpGet('/health');
        console.log(`[test] Server already running on port ${PORT}`);
        return;
    } catch {
        // Not running, start it
    }
    const cmd = `node mcp-server/index.js --profile admin --sse ${PORT} &`;
    execSync(cmd, { stdio: 'ignore', env: { ...process.env, NODE_ENV: 'development' } });

    // Wait for server to be ready
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
            await httpGet('/health');
            console.log(`[test] Server started on port ${PORT}`);
            return;
        } catch { /* retry */ }
    }
    throw new Error('Server failed to start');
});

// ── Health ──

describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
        const { status, body } = await httpGet('/health');
        assert.equal(status, 200);
        assert.equal(body.status, 'ok');
    });

    it('includes all required fields', async () => {
        const { body } = await httpGet('/health');
        assert.equal(typeof body.version, 'string');
        assert.equal(typeof body.profile, 'string');
        assert.equal(typeof body.uptime_seconds, 'number');
        assert.equal(typeof body.active_sessions, 'number');
        assert.equal(typeof body.db, 'string');
        assert.equal(typeof body.timestamp, 'string');
    });

    it('reports admin profile', async () => {
        const { body } = await httpGet('/health');
        assert.equal(body.profile, 'admin');
    });

    it('reports db connected', async () => {
        const { body } = await httpGet('/health');
        assert.equal(body.db, 'connected');
    });
});

// ── CORS ──

describe('CORS', () => {
    it('responds 204 to OPTIONS preflight', async () => {
        const { status } = await httpRequest('OPTIONS', '/health', { Origin: 'https://example.com' });
        assert.equal(status, 204);
    });

    it('sets CORS headers on GET', async () => {
        const { headers } = await httpGet('/health', { Origin: 'https://example.com' });
        assert.ok(headers['access-control-allow-origin']);
    });
});

// ── Session Not Found ──

describe('POST /messages/:invalid', () => {
    it('returns 404 for nonexistent session', async () => {
        const { status, body } = await httpRequest('POST', '/messages/nonexistent', { 'Content-Type': 'application/json' }, '{}');
        assert.equal(status, 404);
        assert.equal(body.error, 'Session not found');
    });
});
