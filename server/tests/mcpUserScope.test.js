import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    resolveMcpUserId,
    registerAgentSession,
    getActiveSessionKeyFromEnv,
    clearMcpUserScopeForTests,
    isBridgePlaceholderUserId,
} from '../../tools/core/mcpUserScope.js';
import { parseSessionKey } from '../../tools/core/agentSessionStore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const USER_A = '00000000-0000-0000-0000-0000000000aa';
const USER_B = '00000000-0000-0000-0000-0000000000bb';
const USER_C = '00000000-0000-0000-0000-0000000000cc';
const ATTACKER = '00000000-0000-0000-0000-0000000000ff';

describe('parseSessionKey', () => {
    it('parses rp:user session keys', () => {
        assert.equal(parseSessionKey(`rp:user:${USER_A}`), USER_A);
    });
});

describe('resolveMcpUserId', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPhase1 = process.env.PHASE1_USER_ID;
    const prevSessionKey = process.env.RISE_PATH_ACTIVE_SESSION_KEY;

    beforeEach(() => {
        clearMcpUserScopeForTests();
        process.env.NODE_ENV = 'development';
        process.env.PHASE1_USER_ID = USER_A;
        delete process.env.RISE_PATH_ACTIVE_SESSION_KEY;
    });

    afterEach(() => {
        clearMcpUserScopeForTests();
        if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNodeEnv;
        if (prevPhase1 === undefined) delete process.env.PHASE1_USER_ID;
        else process.env.PHASE1_USER_ID = prevPhase1;
        if (prevSessionKey === undefined) delete process.env.RISE_PATH_ACTIVE_SESSION_KEY;
        else process.env.RISE_PATH_ACTIVE_SESSION_KEY = prevSessionKey;
    });

    it('uses SSE session userId over attacker args', async () => {
        const sessions = new Map([['sess-1', { userId: USER_B }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'sess-1' },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('scopes learner-profile style resource reads via SSE extra.sessionId', async () => {
        const sessions = new Map([['sse-route-id', { userId: USER_B }]]);
        const result = await resolveMcpUserId({
            argsUserId: undefined,
            extra: { sessionId: 'sse-route-id' },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('ignores attacker args in stdio dev and uses session key env', async () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${USER_B}`;
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: undefined,
            sessions: new Map(),
        });
        assert.equal(result.userId, USER_B);
    });

    it('uses latest agent session binding in dev when env key is absent', async () => {
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: undefined,
            sessions: new Map(),
        });
        assert.equal(result.userId, USER_B);
    });

    it('fails closed in production without session binding', async () => {
        process.env.NODE_ENV = 'production';
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: undefined,
            sessions: new Map(),
        });
        assert.equal(result.error_type, 'session_binding_required');
    });

    it('reads active session key from env helper', () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${USER_A}`;
        assert.equal(getActiveSessionKeyFromEnv(), `rp:user:${USER_A}`);
    });

    it('detects bridge placeholder user ids', () => {
        assert.equal(isBridgePlaceholderUserId(USER_A), true);
        assert.equal(isBridgePlaceholderUserId(USER_B), false);
    });

    it('resolves bridge SSE sessions via agent_session_binding instead of PHASE1', async () => {
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        const sessions = new Map([['bridge-sse', { userId: USER_A }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'bridge-sse' },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('prefers the request\'s X-Hermes-Session-Key on bridge SSE over the PHASE1 connect user', async () => {
        const sessions = new Map([['bridge-sse', { userId: USER_A }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'bridge-sse', requestInfo: { headers: { 'x-hermes-session-key': `rp:user:${USER_B}` } } },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('fails closed for bridge SSE in production without binding', async () => {
        process.env.NODE_ENV = 'production';
        const sessions = new Map([['bridge-sse', { userId: USER_A }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'bridge-sse' },
            sessions,
        });
        assert.equal(result.error_type, 'session_binding_required');
    });
});

// One SSE session can serve many chats (Hermes keeps a single bridge connection), so production
// never resolves a bridge call to "whoever chatted last", and only trusts a session key that
// Express registered (agent_session_binding) for the request that carried it.
describe('resolveMcpUserId for bridge SSE calls in production', () => {
    const FLAG = 'RISE_PATH_MCP_LATEST_BINDING_FALLBACK';
    const ENV_KEYS = ['NODE_ENV', 'PHASE1_USER_ID', 'RISE_PATH_ACTIVE_SESSION_KEY', FLAG];
    const saved = {};

    const bridgeCall = (headers) => resolveMcpUserId({
        argsUserId: ATTACKER,
        extra: { sessionId: 'bridge-sse', ...(headers ? { requestInfo: { headers } } : {}) },
        sessions: new Map([['bridge-sse', { userId: USER_A }]]),
    });

    beforeEach(() => {
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        setPoolForTests(null);
        clearMcpUserScopeForTests();
        process.env.NODE_ENV = 'production';
        process.env.PHASE1_USER_ID = USER_A;
        delete process.env.RISE_PATH_ACTIVE_SESSION_KEY;
        delete process.env[FLAG];
    });

    afterEach(() => {
        clearMcpUserScopeForTests();
        resetPoolForTests();
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it('does not act as the user of another chat\'s binding', async () => {
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        assert.equal((await bridgeCall()).error_type, 'session_binding_required');
    });

    for (const value of ['1', 'true', 'TRUE']) {
        it(`acts as the latest binding's user when ${FLAG}=${value} (single-tenant opt-in)`, async () => {
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            process.env[FLAG] = value;
            assert.equal((await bridgeCall()).userId, USER_B);
        });
    }

    for (const value of ['0', 'false', '', 'yes']) {
        it(`keeps failing closed when ${FLAG}=${JSON.stringify(value)}`, async () => {
            await registerAgentSession(`rp:user:${USER_B}`, USER_B);
            process.env[FLAG] = value;
            assert.equal((await bridgeCall()).error_type, 'session_binding_required');
        });
    }

    it('uses the request\'s session key when Express registered its binding', async () => {
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        assert.equal((await bridgeCall({ 'x-hermes-session-key': `rp:user:${USER_B}` })).userId, USER_B);
    });

    it('does not trust a session key that has no binding', async () => {
        const result = await bridgeCall({ 'x-hermes-session-key': `rp:user:${USER_B}` });
        assert.equal(result.error_type, 'session_binding_required');
    });

    it('ignores the process-wide RISE_PATH_ACTIVE_SESSION_KEY for SSE calls', async () => {
        // Even a key with a live binding: one env value would make every SSE call that user.
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${USER_B}`;
        assert.equal((await bridgeCall()).error_type, 'session_binding_required');
    });

    it('never falls back to another chat when the call named a key that is not registered', async () => {
        await registerAgentSession(`rp:user:${USER_C}`, USER_C);
        process.env[FLAG] = '1';
        const result = await bridgeCall({ 'x-hermes-session-key': `rp:user:${USER_B}` });
        assert.equal(result.error_type, 'session_binding_required');
    });

    it('treats a session the SSE server marked as bridge as one, whatever its connect user', async () => {
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'bridge-sse' },
            sessions: new Map([['bridge-sse', { userId: USER_C, bridge: true }]]),
        });
        assert.equal(result.error_type, 'session_binding_required');
    });

    it('refuses an SSE call whose session is already gone instead of using stdio rules', async () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${USER_B}`;
        const result = await resolveMcpUserId({ argsUserId: ATTACKER, extra: { sessionId: 'closed' }, sessions: new Map() });
        assert.equal(result.error_type, 'session_binding_required');
    });

    it('resolves one call once, so the audit records the user the handler acted as', async () => {
        process.env[FLAG] = '1';
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        const extra = { sessionId: 'bridge-sse' };
        const sessions = new Map([['bridge-sse', { userId: USER_A }]]);
        const first = await resolveMcpUserId({ argsUserId: undefined, extra, sessions });
        await registerAgentSession(`rp:user:${USER_C}`, USER_C, { ttlMs: 10 * 60 * 1000 });
        const again = await resolveMcpUserId({ argsUserId: undefined, extra, sessions });
        assert.equal(first.userId, USER_B);
        assert.equal(again.userId, USER_B);
        // A new call sees the newer binding.
        assert.equal((await resolveMcpUserId({ argsUserId: undefined, extra: { sessionId: 'bridge-sse' }, sessions })).userId, USER_C);
    });

    it('keeps the stdio session key (one local user per process) and never falls back there', async () => {
        process.env.RISE_PATH_ACTIVE_SESSION_KEY = `rp:user:${USER_B}`;
        const stdio = await resolveMcpUserId({ argsUserId: ATTACKER, extra: undefined, sessions: new Map() });
        assert.equal(stdio.userId, USER_B);

        delete process.env.RISE_PATH_ACTIVE_SESSION_KEY;
        process.env[FLAG] = '1';
        await registerAgentSession(`rp:user:${USER_A}`, USER_A);
        const noKey = await resolveMcpUserId({ argsUserId: ATTACKER, extra: undefined, sessions: new Map() });
        assert.equal(noKey.error_type, 'session_binding_required');
    });
});

describe('mcp-server/index.js SSE auth', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mcp-server/index.js'), 'utf8');

    it('does not store X-Hermes-Session-Key on the shared session', () => {
        assert.doesNotMatch(src, /activeSessionKey/);
    });

    it('compares the bridge token in constant time', () => {
        const start = src.indexOf('async function resolveUserId(req)');
        assert.ok(start > -1);
        const body = src.slice(start, src.indexOf('\n    }\n', start));
        assert.match(body, /isBridgeToken\(/);
        assert.doesNotMatch(body, /===\s*bridgeToken/);
    });
});