import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveMcpUserId,
    registerAgentSession,
    getActiveSessionKeyFromEnv,
    clearMcpUserScopeForTests,
    isBridgePlaceholderUserId,
} from '../../tools/core/mcpUserScope.js';
import { parseSessionKey } from '../../tools/core/agentSessionStore.js';

const USER_A = '00000000-0000-0000-0000-0000000000aa';
const USER_B = '00000000-0000-0000-0000-0000000000bb';
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
        const sessions = new Map([['bridge-sse', { userId: USER_A, activeSessionKey: '' }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'bridge-sse' },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('prefers activeSessionKey on bridge SSE over PHASE1 connect user', async () => {
        const sessions = new Map([['bridge-sse', {
            userId: USER_A,
            activeSessionKey: `rp:user:${USER_B}`,
        }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'bridge-sse' },
            sessions,
        });
        assert.equal(result.userId, USER_B);
    });

    it('fails closed for bridge SSE in production without binding', async () => {
        process.env.NODE_ENV = 'production';
        const sessions = new Map([['bridge-sse', { userId: USER_A, activeSessionKey: '' }]]);
        const result = await resolveMcpUserId({
            argsUserId: ATTACKER,
            extra: { sessionId: 'bridge-sse' },
            sessions,
        });
        assert.equal(result.error_type, 'session_binding_required');
    });
});