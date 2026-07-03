import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    recallLearnerMemory,
    rememberLearnerMemory,
} from '../../tools/core/learnerMemory.js';
import {
    setMemantoFetchForTests,
    clearSessionCacheForTests,
} from '../services/learnerMemoryBridge.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const USER_ID = '14fe15a2-bc4a-4449-afca-f39196f383b1';

function createMockPool({
    aiMemoryEnabled = true,
    allowConversationCapture = false,
} = {}) {
    return {
        query: async (sql) => {
            if (String(sql).includes('FROM user_profiles')) {
                return {
                    rowCount: 1,
                    rows: [{
                        preferences: {
                            privacy: {
                                ai_memory: {
                                    enabled: aiMemoryEnabled,
                                    allow_conversation_capture: allowConversationCapture,
                                },
                            },
                        },
                    }],
                };
            }
            if (String(sql).includes('SELECT memanto_agent_id')) {
                return { rowCount: 1, rows: [{ memanto_agent_id: `rp-user-${USER_ID}` }] };
            }
            if (String(sql).includes('UPDATE learner_memory_meta')) {
                return { rowCount: 1, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        },
    };
}

describe('learnerMemory MCP payloads', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        clearSessionCacheForTests();
        resetPoolForTests();
        process.env = { ...originalEnv };
    });

    it('rejects empty recall query', async () => {
        setPoolForTests(createMockPool());
        const result = await recallLearnerMemory({
            userId: USER_ID,
            query: '   ',
        });
        assert.equal(result.error_type, 'validation');
    });

    it('rejects low-confidence remember payloads', async () => {
        setPoolForTests(createMockPool());
        const result = await rememberLearnerMemory({
            userId: USER_ID,
            content: 'Likes visual explanations',
            confidence: 0.5,
        });
        assert.equal(result.error_type, 'validation');
    });

    it('rejects remember when opt-in is off', async () => {
        setPoolForTests(createMockPool({ aiMemoryEnabled: false }));
        const result = await rememberLearnerMemory({
            userId: USER_ID,
            content: 'Likes visual explanations',
            confidence: 0.9,
        });
        assert.equal(result.error_type, 'ai_memory_not_allowed');
    });

    it('skips default MCP remember when conversation capture is disabled', async () => {
        setPoolForTests(createMockPool({ allowConversationCapture: false }));
        const result = await rememberLearnerMemory({
            userId: USER_ID,
            content: 'Prefers morning study',
            confidence: 0.9,
        });
        assert.equal(result.ok, true);
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'conversation_capture_disabled');
    });

    it('allows explicit MCP remember with trusted source when capture is disabled', async () => {
        const fetchFn = async (url, init = {}) => {
            const path = String(url);
            if (path.endsWith('/activate')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        session_token: 'test-session-token',
                        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                    }),
                };
            }
            if (path.includes('/remember')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ memory_id: 'mem-explicit', status: 'queued' }),
                };
            }
            return { ok: true, status: 200, json: async () => ({ agent_id: `rp-user-${USER_ID}` }) };
        };
        setMemantoFetchForTests(fetchFn);
        setPoolForTests(createMockPool({ allowConversationCapture: false }));

        const result = await rememberLearnerMemory({
            userId: USER_ID,
            content: 'Remember this preference',
            confidence: 0.9,
            provenance: 'explicit_statement',
            source: 'hermes-explicit',
        });

        assert.equal(result.ok, true);
        assert.equal(result.memory_id, 'mem-explicit');
    });

    it('rejects untrusted explicit_statement source from MCP', async () => {
        setPoolForTests(createMockPool());
        const result = await rememberLearnerMemory({
            userId: USER_ID,
            content: 'Sneaky remember',
            confidence: 0.9,
            provenance: 'explicit_statement',
            source: 'rise-path-mcp',
        });
        assert.equal(result.error_type, 'validation');
    });

    it('returns disabled recall without Memanto call when opt-in is off', async () => {
        setPoolForTests(createMockPool({ aiMemoryEnabled: false }));
        setMemantoFetchForTests(async () => {
            throw new Error('Memanto should not be called');
        });

        const result = await recallLearnerMemory({
            userId: USER_ID,
            query: 'preferred study time',
        });
        assert.equal(result.semantic_memory_status, 'disabled');
        assert.equal(result.count, 0);
    });
});