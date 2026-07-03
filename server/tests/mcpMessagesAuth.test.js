import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyMessagesSessionAuth } from '../../mcp-server/sseMessagesAuth.js';

const USER_A = '00000000-0000-0000-0000-0000000000aa';
const USER_B = '00000000-0000-0000-0000-0000000000bb';

describe('verifyMessagesSessionAuth', () => {
    it('returns 401 when resolvedUserId is missing', () => {
        const result = verifyMessagesSessionAuth(null, USER_A);
        assert.deepEqual(result, { status: 401, error: 'Authentication required' });
    });

    it('returns 403 when token user does not own the session', () => {
        const result = verifyMessagesSessionAuth(USER_B, USER_A);
        assert.deepEqual(result, { status: 403, error: 'Session owner mismatch' });
    });

    it('returns null when token user matches session owner', () => {
        assert.equal(verifyMessagesSessionAuth(USER_A, USER_A), null);
    });
});