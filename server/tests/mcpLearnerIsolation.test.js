// One learner's MCP calls never reach another learner's data.
// - rag-search (tools/core/ragSearch.js searchContent) reads only the acting learner's ready
//   materials on every SQL path, and nothing without a learner.
// - The MCP server resolves the learner per call: rag-search goes through it, a bridge client
//   cannot name a learner with X-Hermes-Session-Key: rp:user:<uuid>, every tool takes rp_turn.
// - Call limits (per tool, and the HTTP limit per minute) count per learner on the shared Hermes
//   session; database text stays in the log, /health included.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    searchContent,
    setEmbeddingClientForTests,
    resetEmbeddingClientForTests,
    resetLegacyEmbeddingWarningForTests,
} from '../../tools/core/ragSearch.js';
import { classifyDbError } from '../../tools/core/dbErrors.js';
import { checkPolicy, clearSession } from '../../mcp-server/policy.js';
import { registry } from '../../mcp-server/profileFilter.js';
import { createMessageRateLimiter, messageRateLimitKey } from '../../mcp-server/messageRateLimit.js';
import { registerAgentTurn, clearMcpUserScopeForTests, getPhase1UserId, TURN_KEY_PREFIX } from '../../tools/core/mcpUserScope.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEARNER_A = 'a0000000-0000-4000-8000-00000000000a';
const LEARNER_B = 'b0000000-0000-4000-8000-00000000000b';
const QUERY = 'Blender modifier';

/** Material chunks of two learners: current-model, older-model (null) and a not-ready upload. */
const CHUNKS = [
    { owner: LEARNER_A, status: 'ready', material_id: 'a-current', chunk_index: 0, model: EMBEDDING_MODEL, content: 'A notes: Blender modifier stack' },
    { owner: LEARNER_A, status: 'ready', material_id: 'a-legacy', chunk_index: 1, model: null, content: 'A old notes: Blender modifier order' },
    { owner: LEARNER_A, status: 'processing', material_id: 'a-processing', chunk_index: 0, model: EMBEDDING_MODEL, content: 'A half-ingested upload: Blender modifier' },
    { owner: LEARNER_B, status: 'ready', material_id: 'b-current', chunk_index: 0, model: EMBEDDING_MODEL, content: 'B private diary: Blender modifier secrets' },
    { owner: LEARNER_B, status: 'ready', material_id: 'b-legacy', chunk_index: 2, model: null, content: 'B private notes: Blender modifier tricks' },
];

/**
 * Mock pool that answers like Postgres over CHUNKS: a statement sees the chunks its own
 * `m.user_id = $n` and `m.status = 'ready'` conditions allow (an unscoped one sees everyone's).
 */
function ownedChunkPool({ hasVector = true, chunks = CHUNKS } = {}) {
    const queries = [];
    const query = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ sql: text, params });
        if (/FROM pg_type/.test(text)) return { rowCount: hasVector ? 1 : 0, rows: hasVector ? [{}] : [] };
        const owner = /m\.user_id = \$(\d+)/.exec(text);
        const ownerId = owner ? params[Number(owner[1]) - 1] : null;
        const readyOnly = text.includes("m.status = 'ready'");
        const visible = chunks.filter((c) => (!owner || c.owner === ownerId) && (!readyOnly || c.status === 'ready'));
        const row = (c, extra = {}) => ({ content: c.content, chunk_index: c.chunk_index, material_id: c.material_id, ...extra });
        if (/AS has_current/.test(text)) {
            const has_current = visible.some((c) => c.model === EMBEDDING_MODEL);
            const has_legacy = visible.some((c) => c.model !== EMBEDDING_MODEL);
            return { rowCount: 1, rows: [{ has_current, has_legacy }] };
        }
        if (/<=>/.test(text)) {
            const rows = visible.filter((c) => c.model === EMBEDDING_MODEL).map((c) => row(c, { distance: 0.2 }));
            return { rowCount: rows.length, rows };
        }
        if (/ILIKE/.test(text)) {
            const legacyOnly = /c\.embedding_model IS NULL OR/.test(text);
            const words = params.filter((p) => typeof p === 'string' && p.startsWith('%')).map((p) => p.slice(1, -1).toLowerCase());
            const rows = visible
                .filter((c) => (!legacyOnly || c.model !== EMBEDDING_MODEL) && words.some((w) => c.content.toLowerCase().includes(w)))
                .map((c) => row(c));
            return { rowCount: rows.length, rows };
        }
        return { rowCount: 0, rows: [] };
    };
    return { queries, query, async connect() { return { query, release() {} }; } };
}

const embeddingClient = ({ fail = false } = {}) => ({
    models: {
        async embedContent(params) {
            if (fail) throw new Error('embedding quota exceeded');
            const contents = Array.isArray(params.contents) ? params.contents : [params.contents];
            return { embeddings: contents.map(() => ({ values: Array.from({ length: EMBEDDING_DIM }, () => 0.1) })) };
        },
    },
});

/** Every statement over material_chunks names the learner and 'ready' once per material_chunks scan. */
function assertLearnerScoped(pool, learner) {
    const statements = pool.queries.filter((q) => !/FROM pg_type/.test(q.sql));
    assert.ok(statements.length > 0, 'searched');
    for (const q of statements) {
        const scans = (q.sql.match(/FROM material_chunks/g) || []).length;
        const owners = [...q.sql.matchAll(/m\.user_id = \$(\d+)/g)];
        assert.equal(owners.length, scans, `user filter on every scan: ${q.sql}`);
        for (const [, n] of owners) assert.equal(q.params[Number(n) - 1], learner, q.sql);
        assert.equal((q.sql.match(/m\.status = 'ready'/g) || []).length, scans, `ready filter on every scan: ${q.sql}`);
    }
}

const sources = (result) => result.results.map((r) => r.source).sort();

/** Run fn with console.warn silenced (legacy-embedding notice). */
const quiet = async (fn) => {
    const { warn } = console;
    console.warn = () => {};
    try { return await fn(); } finally { console.warn = warn; }
};

describe('rag-search core (searchContent) reads only the acting learner\'s materials', () => {
    afterEach(() => {
        resetPoolForTests();
        resetEmbeddingClientForTests();
        resetLegacyEmbeddingWarningForTests();
    });

    const paths = [
        {
            name: 'vector search (every chunk uses the current model)',
            pool: { chunks: CHUNKS.filter((c) => c.model === EMBEDDING_MODEL) },
            client: embeddingClient(),
            expect: ['a-current'],
            searchType: 'vector',
        },
        { name: 'vector + keyword merge (mixed models)', pool: {}, client: embeddingClient(), expect: ['a-current', 'a-legacy'], searchType: 'vector+keyword' },
        {
            name: 'keyword fallback when no chunk uses the current model',
            pool: { chunks: CHUNKS.map((c) => ({ ...c, model: null })) },
            client: embeddingClient(),
            expect: ['a-current', 'a-legacy'],
            searchType: 'keyword',
        },
        { name: 'keyword fallback without an embedding key', pool: {}, client: null, expect: ['a-current', 'a-legacy'], searchType: 'keyword' },
        { name: 'keyword fallback when the query embedding fails', pool: {}, client: embeddingClient({ fail: true }), expect: ['a-current', 'a-legacy'], searchType: 'keyword' },
        { name: 'keyword fallback without pgvector', pool: { hasVector: false }, client: embeddingClient(), expect: ['a-current', 'a-legacy'], searchType: 'keyword' },
    ];

    for (const p of paths) {
        it(p.name, async () => {
            const pool = ownedChunkPool(p.pool);
            setPoolForTests(pool);
            setEmbeddingClientForTests(p.client);
            const result = await quiet(() => searchContent({ query: QUERY, maxResults: 5, userId: LEARNER_A }));
            assert.equal(result.search_type, p.searchType, JSON.stringify(result));
            assert.deepEqual(sources(result), p.expect, 'only A\'s ready materials');
            assertLearnerScoped(pool, LEARNER_A);

            const asB = await quiet(() => searchContent({ query: QUERY, maxResults: 5, userId: LEARNER_B }));
            assert.ok(asB.results.length > 0 && asB.results.every((r) => r.source.startsWith('b-')), JSON.stringify(sources(asB)));
        });
    }

    it('without a learner (missing, empty or not a UUID) runs no query and returns nothing', async () => {
        for (const userId of [undefined, null, '', 'not-a-uuid', `${LEARNER_A}' OR '1'='1`, 42]) {
            const pool = ownedChunkPool();
            setPoolForTests(pool);
            setEmbeddingClientForTests(embeddingClient());
            const result = await quiet(() => searchContent({ query: QUERY, userId }));
            assert.deepEqual(result.results, [], String(userId));
            assert.equal(result.search_type, 'none');
            assert.equal(pool.queries.length, 0, `no SQL for ${String(userId)}`);
        }
    });

    it('caps max results at 10', async () => {
        const pool = ownedChunkPool();
        setPoolForTests(pool);
        setEmbeddingClientForTests(embeddingClient());
        await quiet(() => searchContent({ query: QUERY, maxResults: 500, userId: LEARNER_A }));
        const limits = pool.queries
            .filter((q) => /LIMIT \$\d+$/.test(q.sql))
            .map((q) => q.params[Number(/LIMIT \$(\d+)$/.exec(q.sql)[1]) - 1]);
        assert.ok(limits.length > 0);
        assert.ok(limits.every((n) => n === 10), JSON.stringify(limits));
    });
});

describe('per-learner call limits on one shared (Hermes bridge) session', () => {
    after(() => clearSession('bridge-session'));

    it("learner A using up journal-log does not block learner B on the same session", () => {
        const cap = registry.tools.find((t) => t.tool_id === 'journal-log').max_calls_per_session;
        assert.ok(cap > 0);
        for (let i = 0; i < cap; i += 1) assert.equal(checkPolicy('journal-log', 'bridge-session', LEARNER_A).allowed, true);
        const blocked = checkPolicy('journal-log', 'bridge-session', LEARNER_A);
        assert.equal(blocked.allowed, false);
        assert.equal(blocked.reason, 'rate_limit_exceeded');
        assert.equal(checkPolicy('journal-log', 'bridge-session', LEARNER_B).allowed, true, 'B has its own count');
        clearSession('bridge-session');
        assert.equal(checkPolicy('journal-log', 'bridge-session', LEARNER_A).allowed, true, 'reset on disconnect');
    });
});

describe('HTTP rate limit (POST /messages) on the shared bridge session counts per learner', () => {
    const LIMIT = 3;
    /** @type {Map<string, { userId: string }>} */
    let sessions;
    let server;
    let base;
    let turnA;
    let turnB;

    before(async () => {
        clearMcpUserScopeForTests();
        sessions = new Map([
            ['bridge-sse', { userId: getPhase1UserId() }],
            ['jwt-sse', { userId: LEARNER_A }],
        ]);
        turnA = await registerAgentTurn(LEARNER_A);
        turnB = await registerAgentTurn(LEARNER_B);
        // As mcp-server/index.js mounts it: the body parsed first, then the limiter.
        const app = express();
        app.post('/messages/:sessionId', express.json(), createMessageRateLimiter({ sessions, limit: LIMIT }), (_req, res) => res.status(202).end());
        server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    after(async () => {
        clearMcpUserScopeForTests();
        await new Promise((resolve) => server.close(resolve));
    });

    const toolCall = (rpTurn) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'rag-search', arguments: { query: QUERY, ...(rpTurn ? { rp_turn: rpTurn } : {}) } } });
    const post = async (sessionId, body, headers = {}) => (await fetch(`${base}/messages/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    })).status;

    it('keys a bridge call on the learner of its rp_turn, else on the session', async () => {
        const req = (sessionId, body, headers = {}) => ({ params: { sessionId }, body, headers });
        assert.equal(await messageRateLimitKey(req('bridge-sse', toolCall(turnA)), sessions), `learner:${LEARNER_A}`);
        assert.equal(await messageRateLimitKey(req('bridge-sse', toolCall(), { 'x-hermes-session-key': `${TURN_KEY_PREFIX}${turnB}` }), sessions), `learner:${LEARNER_B}`);
        assert.equal(await messageRateLimitKey(req('bridge-sse', toolCall('current')), sessions), 'session:bridge-sse');
        assert.equal(await messageRateLimitKey(req('bridge-sse', toolCall('x'.repeat(32))), sessions), 'session:bridge-sse', 'unknown token');
        assert.equal(await messageRateLimitKey(req('bridge-sse', { jsonrpc: '2.0', id: 2, method: 'tools/list' }), sessions), 'session:bridge-sse');
        assert.equal(await messageRateLimitKey(req('jwt-sse', toolCall(turnB)), sessions), 'session:jwt-sse', "a learner's own session ignores rp_turn");
    });

    it('learner A using up the limit does not block learner B or the session', async () => {
        for (let i = 0; i < LIMIT; i += 1) assert.equal(await post('bridge-sse', toolCall(turnA)), 202);
        assert.equal(await post('bridge-sse', toolCall(turnA)), 429, 'A is limited');
        assert.equal(await post('bridge-sse', toolCall(turnB)), 202, 'B has its own count');
        assert.equal(await post('bridge-sse', toolCall(), { 'X-Hermes-Session-Key': `${TURN_KEY_PREFIX}${turnB}` }), 202, 'B by header');
        assert.equal(await post('bridge-sse', { jsonrpc: '2.0', id: 3, method: 'tools/list' }), 202, 'the session count is separate');
    });

    it("a learner's own JWT session still counts per session", async () => {
        for (let i = 0; i < LIMIT; i += 1) assert.equal(await post('jwt-sse', toolCall(turnB)), 202);
        assert.equal(await post('jwt-sse', toolCall(turnB)), 429);
    });
});

describe('database error text does not reach tool results', () => {
    it('classifyDbError keeps the driver message out of an unclassified error', () => {
        const err = Object.assign(new Error('column "secret_col" of relation "materials" does not exist at "B private diary"'), { code: '42703' });
        const { error } = console;
        console.error = () => {};
        let result;
        try { result = classifyDbError(err, 'ragSearch'); } finally { console.error = error; }
        assert.deepEqual(result, { error: 'ragSearch failed', error_type: 'unknown' });
    });
});

// ---------------------------------------------------------------------------------------------
// The MCP server process: production mode, no database, no learner.
// ---------------------------------------------------------------------------------------------

/** Environment for a spawned MCP server: production, no DB, no operator session key, no Supabase. */
const serverEnv = (extra = {}) => ({
    ...process.env,
    NODE_ENV: 'production',
    RISE_PATH_MCP_PROFILE: 'learner',
    DATABASE_URL_PHASE1: '',
    RISE_PATH_ACTIVE_SESSION_KEY: '',
    HERMES_ACTIVE_SESSION_KEY: '',
    X_HERMES_SESSION_KEY: '',
    SUPABASE_URL: '',
    VITE_SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_ANON_KEY: '',
    VITE_SUPABASE_ANON_KEY: '',
    ...extra,
});

const parse = (result) => JSON.parse(result.content[0].text);

describe('MCP server (stdio, production): rag-search resolves the learner first', () => {
    let client;
    before(async () => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [path.join(ROOT, 'mcp-server/index.js')],
            cwd: ROOT,
            env: serverEnv(),
            stderr: 'pipe',
        });
        client = new Client({ name: 'mcp-learner-isolation-test', version: '1.0.0' });
        await client.connect(transport);
    });
    after(async () => { await client?.close(); });

    it('every tool takes an optional rp_turn; rag-search documents its 1-10 cap without enforcing it in the schema', async () => {
        const { tools } = await client.listTools();
        assert.ok(tools.length > 0);
        for (const tool of tools) {
            assert.equal(tool.inputSchema.properties.rp_turn?.type, 'string', tool.name);
            assert.ok(!(tool.inputSchema.required || []).includes('rp_turn'), tool.name);
        }
        const maxResults = tools.find((t) => t.name === 'rag-search').inputSchema.properties.max_results;
        assert.equal(maxResults.type, 'number');
        assert.equal(maxResults.maximum, undefined, 'searchContent clamps; the schema does not reject');
        assert.match(maxResults.description, /1-10/);
    });

    it('the user_id argument sends the model to rp_turn, not to an automatic resolution', async () => {
        const scoped = (await client.listTools()).tools.filter((t) => t.inputSchema.properties.user_id);
        assert.ok(scoped.length > 0);
        for (const tool of scoped) {
            const desc = tool.inputSchema.properties.user_id.description;
            assert.match(desc, /rp_turn/, tool.name);
            assert.doesNotMatch(desc, /自動解決/, tool.name);
        }
    });

    it('rag-search with max_results 20 is not a validation error (it reaches the learner check)', async () => {
        const result = await client.callTool({ name: 'rag-search', arguments: { query: QUERY, max_results: 20 } });
        assert.equal(parse(result).error_type, 'session_binding_required', result.content[0].text);
    });

    it('rag-search without a learner fails closed instead of searching', async () => {
        const result = await client.callTool({ name: 'rag-search', arguments: { query: QUERY } });
        assert.equal(result.isError, true);
        assert.equal(parse(result).error_type, 'session_binding_required');
    });

    it('rag-search with an unknown rp_turn fails closed', async () => {
        const result = await client.callTool({ name: 'rag-search', arguments: { query: QUERY, rp_turn: 'Zm9yZ2VkLXR1cm4tdG9rZW4tMTIzNDU2' } });
        assert.equal(result.isError, true);
        assert.equal(parse(result).error_type, 'session_binding_required');
        assert.match(parse(result).error, /rp_turn/);
    });
});

describe('Hermes skills tell the model to pass rp_turn', () => {
    it('no skill says user_id is resolved automatically; life-habit-analyst asks for rp_turn', () => {
        const skillsDir = path.join(ROOT, 'skills');
        for (const name of fs.readdirSync(skillsDir)) {
            const file = path.join(skillsDir, name, 'SKILL.md');
            if (!fs.existsSync(file)) continue;
            assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /自動解決/, `skills/${name}/SKILL.md`);
        }
        assert.match(fs.readFileSync(path.join(skillsDir, 'life-habit-analyst/SKILL.md'), 'utf8'), /`rp_turn` を必ず渡す/);
    });
});

const freePort = () => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port: free } = /** @type {net.AddressInfo} */ (probe.address());
        probe.close(() => resolve(free));
    });
});

/** Spawn the MCP server with --sse on a free port; resolves once it listens. */
async function startSseServer(env) {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp-server/index.js'), '--sse', String(port)], {
        cwd: ROOT,
        env: serverEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`SSE server did not start:\n${stderr}`)), 15000);
        child.stdout.on('data', (chunk) => {
            if (String(chunk).includes('running on')) { clearTimeout(timer); resolve(undefined); }
        });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`SSE server exited ${code}:\n${stderr}`)); });
    });
    return { child, port, stderr: () => stderr };
}

describe('MCP server (SSE, production): /health does not publish database errors', () => {
    let server;
    before(async () => {
        // A database URL where nothing listens: the check fails with the driver's text.
        server = await startSseServer({ DATABASE_URL_PHASE1: `postgresql://rp_user:rp_pass@127.0.0.1:${await freePort()}/secret_db` });
    });
    after(() => { server?.child.kill(); });

    it("answers db: 'disconnected' only, and logs the driver's error", async () => {
        const response = await fetch(`http://127.0.0.1:${server.port}/health`);
        const text = await response.text();
        const body = JSON.parse(text);
        assert.equal(body.db, 'disconnected', text);
        assert.equal(body.status, 'degraded');
        assert.ok(!('db_error' in body), text);
        for (const fragment of ['ECONNREFUSED', 'secret_db', 'rp_user', '127.0.0.1']) assert.ok(!text.includes(fragment), `${fragment} in ${text}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.match(server.stderr(), /\/health database check failed/);
    });
});

describe('MCP server (SSE bridge, production): a bridge client cannot name the learner', () => {
    const BRIDGE_TOKEN = 'test-bridge-token-learner-isolation';
    let server;
    let port;

    before(async () => {
        server = await startSseServer({ RISE_PATH_BRIDGE_TOKEN: BRIDGE_TOKEN });
        port = server.port;
    });
    after(() => { server?.child.kill(); });

    const connect = async (headers) => {
        const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`), {
            requestInit: { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, ...headers } },
        });
        const client = new Client({ name: 'mcp-bridge-isolation-test', version: '1.0.0' });
        await client.connect(transport);
        return client;
    };

    it('X-Hermes-Session-Key: rp:user:<uuid> does not select that learner', async () => {
        const client = await connect({ 'X-Hermes-Session-Key': `rp:user:${LEARNER_B}` });
        try {
            for (const [name, args] of [['rag-search', { query: QUERY }], ['learner-state-get', {}]]) {
                const result = await client.callTool({ name, arguments: args });
                assert.equal(result.isError, true, name);
                assert.equal(parse(result).error_type, 'session_binding_required', `${name}: ${result.content[0].text}`);
            }
        } finally {
            await client.close();
        }
    });

    it('POST /messages answers a body that is not JSON with a fixed 400, and an unknown session with 404', async () => {
        // A raw SSE connection: its first event names the session's POST endpoint.
        const auth = { Authorization: `Bearer ${BRIDGE_TOKEN}` };
        const sse = await fetch(`http://127.0.0.1:${port}/sse`, { headers: auth });
        const reader = sse.body.getReader();
        try {
            let text = '';
            const decoder = new TextDecoder();
            while (!/\/messages\/[0-9a-f-]{36}/.test(text)) {
                const { value, done } = await reader.read();
                assert.ok(!done, `stream ended before the endpoint event: ${text}`);
                text += decoder.decode(value, { stream: true });
            }
            const endpoint = /\/messages\/[0-9a-f-]{36}/.exec(text)[0];
            const post = (urlPath, rawBody) => fetch(`http://127.0.0.1:${port}${urlPath}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...auth },
                body: rawBody,
            });
            const malformed = await post(endpoint, '{"jsonrpc": ');
            assert.equal(malformed.status, 400);
            assert.deepEqual(await malformed.json(), { error: 'Bad Request' });
            const unknown = await post('/messages/00000000-0000-4000-8000-000000000000', '{}');
            assert.equal(unknown.status, 404);
            const ping = await post(endpoint, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
            assert.equal(ping.status, 202, 'a parsed JSON body still reaches the transport');
        } finally {
            await reader.cancel();
        }
    });

    it('an rp:turn header that was never minted fails closed', async () => {
        const client = await connect({ 'X-Hermes-Session-Key': 'rp:turn:Zm9yZ2VkLXR1cm4tdG9rZW4tMTIzNDU2' });
        try {
            const result = await client.callTool({ name: 'rag-search', arguments: { query: QUERY } });
            assert.equal(parse(result).error_type, 'session_binding_required');
            assert.match(parse(result).error, /rp_turn is unknown or expired/);
        } finally {
            await client.close();
        }
    });
});
