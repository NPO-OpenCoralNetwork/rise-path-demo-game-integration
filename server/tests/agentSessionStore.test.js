import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseSessionKey,
    setAgentChatConsent,
    getAgentChatConsent,
    registerAgentSession,
    clearAgentChatConsentForTests,
} from '../../tools/core/agentSessionStore.js';
import { clearMcpUserScopeForTests, resolveMcpUserId } from '../../tools/core/mcpUserScope.js';

const USER_A = '00000000-0000-0000-0000-0000000000aa';
const USER_B = '00000000-0000-0000-0000-0000000000bb';

describe('parseSessionKey', () => {
    it('parses rp:user:{uuid} session keys', () => {
        assert.equal(parseSessionKey(`rp:user:${USER_A}`), USER_A);
        assert.equal(parseSessionKey('invalid'), null);
    });
});

describe('agent chat consent store', () => {
    beforeEach(() => {
        clearAgentChatConsentForTests();
        clearMcpUserScopeForTests();
    });

    it('defaults to false when unset', async () => {
        assert.equal(await getAgentChatConsent(USER_A), false);
    });

    it('stores and reads opt-in consent in memory', async () => {
        await setAgentChatConsent(USER_A, { includeDiaryExcerpts: true });
        assert.equal(await getAgentChatConsent(USER_A), true);
    });

    it('isolates consent per user', async () => {
        await setAgentChatConsent(USER_A, { includeDiaryExcerpts: true });
        await setAgentChatConsent(USER_B, { includeDiaryExcerpts: false });
        assert.equal(await getAgentChatConsent(USER_A), true);
        assert.equal(await getAgentChatConsent(USER_B), false);
    });

    it('overwrites consent on subsequent requests', async () => {
        await setAgentChatConsent(USER_A, { includeDiaryExcerpts: true });
        await setAgentChatConsent(USER_A, { includeDiaryExcerpts: false });
        assert.equal(await getAgentChatConsent(USER_A), false);
    });

    it('session binding enables MCP stdio user resolution in dev', async () => {
        await registerAgentSession(`rp:user:${USER_B}`, USER_B);
        const result = await resolveMcpUserId({
            argsUserId: USER_A,
            extra: undefined,
            sessions: new Map(),
        });
        assert.equal(result.userId, USER_B);
    });
});