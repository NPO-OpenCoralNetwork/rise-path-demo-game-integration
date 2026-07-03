import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLearnerAgentId,
    buildAssessmentSeedMemories,
    seedAssessmentMemories,
    rememberForLearner,
    recallForLearner,
    ensureLearnerAgent,
    setMemantoFetchForTests,
    clearSessionCacheForTests,
    isMemantoEnabled,
} from '../services/learnerMemoryBridge.js';

const USER_ID = '14fe15a2-bc4a-4449-afca-f39196f383b1';
const AGENT_ID = `rp-user-${USER_ID}`;

const SPEC_RAW_PROFILE = {
    big_five: { openness: 72, conscientiousness: 48, extraversion: 35, agreeableness: 61, neuroticism: 68 },
    learning_style: 'example_first',
    motivation: 'credential_and_progress',
    declared_preferences: { assessment_preference: 'quiz_and_practice', explanation_style: 'step_by_step' },
};

function createMockPool({
    aiMemoryEnabled = false,
    allowConversationCapture = false,
    assessmentSeedVersion = null,
    metaExists = false,
} = {}) {
    const state = {
        metaInserted: metaExists,
        assessmentSeedVersion,
        memoryCount: 0,
        preferences: {
            privacy: {
                ai_memory: {
                    enabled: aiMemoryEnabled,
                    allow_conversation_capture: allowConversationCapture,
                },
            },
        },
    };

    return {
        state,
        query: async (sql, params = []) => {
            const text = String(sql);

            if (text.includes('FROM user_profiles')) {
                return { rowCount: 1, rows: [{ preferences: state.preferences }] };
            }

            if (text.includes('INSERT INTO learner_memory_meta')) {
                state.metaInserted = true;
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('SELECT memanto_agent_id FROM learner_memory_meta')) {
                if (!state.metaInserted) return { rowCount: 0, rows: [] };
                return { rowCount: 1, rows: [{ memanto_agent_id: AGENT_ID }] };
            }

            if (text.includes('SELECT assessment_seed_version FROM learner_memory_meta')) {
                if (!state.metaInserted) return { rowCount: 0, rows: [] };
                return {
                    rowCount: 1,
                    rows: [{ assessment_seed_version: state.assessmentSeedVersion }],
                };
            }

            if (text.includes('UPDATE learner_memory_meta')) {
                if (text.includes('assessment_seed_version')) {
                    state.assessmentSeedVersion = params[1];
                }
                if (text.includes('memory_count_estimate = memory_count_estimate + 1')) {
                    state.memoryCount += 1;
                }
                if (text.includes('memory_count_estimate = GREATEST')) {
                    state.memoryCount = Math.max(0, state.memoryCount - 1);
                }
                return { rowCount: 1, rows: [] };
            }

            throw new Error(`Unexpected query: ${text}`);
        },
    };
}

function createMemantoFetchRecorder() {
    const calls = [];
    const fetchFn = async (url, init = {}) => {
        calls.push({ url, init });
        const path = String(url);

        if (path.endsWith('/agents') && init.method === 'POST') {
            return { ok: true, status: 201, json: async () => ({ agent_id: AGENT_ID }) };
        }
        if (path.endsWith('/activate') && init.method === 'POST') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    session_token: 'test-session-token',
                    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                }),
            };
        }
        if (path.endsWith('/remember') && init.method === 'POST') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    memory_id: `mem-${calls.length}`,
                    status: 'queued',
                }),
            };
        }
        if (path.endsWith('/recall') && init.method === 'POST') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    memories: [{
                        id: 'mem-1',
                        type: 'preference',
                        title: 'Morning study',
                        content: 'Prefers morning sessions',
                        confidence: 0.9,
                        tags: ['schedule'],
                        score: 0.55,
                        created_at: '2026-06-20T10:00:00Z',
                    }],
                    count: 1,
                }),
            };
        }

        return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
    };

    return { calls, fetchFn };
}

describe('buildLearnerAgentId', () => {
    it('prefixes supabase uuid', () => {
        assert.equal(buildLearnerAgentId(USER_ID), AGENT_ID);
    });
});

describe('buildAssessmentSeedMemories', () => {
    it('creates three validated memories', () => {
        const memories = buildAssessmentSeedMemories({
            assessmentType: 'big_five_v1',
            rawProfile: SPEC_RAW_PROFILE,
            derivedLearningProfile: {
                example_first_preference: 'high',
                structure_need: 'medium',
            },
        });

        assert.equal(memories.length, 3);
        assert.equal(memories[0].type, 'fact');
        assert.match(memories[0].content, /Big Five \(big_five_v1\)/);
        assert.equal(memories[1].type, 'learning');
        assert.equal(memories[2].type, 'learning');
        assert.equal(memories[0].provenance, 'validated');
    });
});

describe('rememberForLearner opt-in gate', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        clearSessionCacheForTests();
        process.env = { ...originalEnv };
    });

    it('returns ai_memory_not_allowed when opt-in is off', async () => {
        const pool = createMockPool({ aiMemoryEnabled: false });
        const result = await rememberForLearner({
            pool,
            userId: USER_ID,
            content: 'Prefers short sessions',
            type: 'preference',
            confidence: 0.9,
        });

        assert.equal(result.error_type, 'ai_memory_not_allowed');
    });

    it('stores memory when opt-in is on', async () => {
        const { fetchFn } = createMemantoFetchRecorder();
        setMemantoFetchForTests(fetchFn);
        const pool = createMockPool({ aiMemoryEnabled: true });

        const result = await rememberForLearner({
            pool,
            userId: USER_ID,
            content: 'Prefers short sessions',
            type: 'preference',
            confidence: 0.9,
        });

        assert.equal(result.ok, true);
        assert.ok(result.memory_id);
    });

    it('skips inferred remembers when conversation capture is disabled', async () => {
        const { fetchFn } = createMemantoFetchRecorder();
        setMemantoFetchForTests(fetchFn);
        const pool = createMockPool({
            aiMemoryEnabled: true,
            allowConversationCapture: false,
        });

        const result = await rememberForLearner({
            pool,
            userId: USER_ID,
            content: 'Prefers short sessions',
            type: 'preference',
            confidence: 0.9,
            provenance: 'inferred',
            source: 'hermes-skill',
        });

        assert.equal(result.ok, true);
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'conversation_capture_disabled');
    });

    it('allows validated remembers when conversation capture is disabled', async () => {
        const { fetchFn } = createMemantoFetchRecorder();
        setMemantoFetchForTests(fetchFn);
        const pool = createMockPool({
            aiMemoryEnabled: true,
            allowConversationCapture: false,
        });

        const result = await rememberForLearner({
            pool,
            userId: USER_ID,
            content: 'Big Five summary',
            type: 'fact',
            confidence: 0.9,
            provenance: 'validated',
            source: 'rise-path-assessment',
        });

        assert.equal(result.ok, true);
        assert.ok(result.memory_id);
    });
});

describe('recallForLearner opt-in gate', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        clearSessionCacheForTests();
        process.env = { ...originalEnv };
    });

    it('returns disabled status without calling Memanto when opt-in is off', async () => {
        const { fetchFn, calls } = createMemantoFetchRecorder();
        setMemantoFetchForTests(fetchFn);
        const pool = createMockPool({ aiMemoryEnabled: false });

        const result = await recallForLearner({
            pool,
            userId: USER_ID,
            query: 'learning style',
        });

        assert.equal(result.semantic_memory_status, 'disabled');
        assert.equal(result.count, 0);
        assert.equal(calls.length, 0);
    });
});

describe('seedAssessmentMemories', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        clearSessionCacheForTests();
        process.env = { ...originalEnv };
    });

    it('skips when ai_memory is disabled', async () => {
        const pool = createMockPool({ aiMemoryEnabled: false });
        const result = await seedAssessmentMemories({
            pool,
            userId: USER_ID,
            profile: {
                profileVersion: 1,
                assessmentType: 'big_five_v1',
                rawProfile: SPEC_RAW_PROFILE,
                derivedLearningProfile: {},
            },
        });

        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'ai_memory_disabled');
    });

    it('skips duplicate seed for the same profile version', async () => {
        const pool = createMockPool({
            aiMemoryEnabled: true,
            metaExists: true,
            assessmentSeedVersion: 2,
        });

        const result = await seedAssessmentMemories({
            pool,
            userId: USER_ID,
            profile: {
                profileVersion: 2,
                assessmentType: 'big_five_v1',
                rawProfile: SPEC_RAW_PROFILE,
                derivedLearningProfile: {},
            },
        });

        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'already_seeded');
    });

    it('seeds three memories for a new profile version', async () => {
        const { fetchFn } = createMemantoFetchRecorder();
        setMemantoFetchForTests(fetchFn);
        const pool = createMockPool({
            aiMemoryEnabled: true,
            metaExists: true,
            assessmentSeedVersion: 1,
        });

        const result = await seedAssessmentMemories({
            pool,
            userId: USER_ID,
            profile: {
                profileVersion: 2,
                assessmentType: 'big_five_v1',
                rawProfile: SPEC_RAW_PROFILE,
                derivedLearningProfile: {
                    example_first_preference: 'high',
                },
            },
        });

        assert.equal(result.seeded, true);
        assert.equal(result.count, 3);
        assert.equal(pool.state.assessmentSeedVersion, 2);
    });
});

describe('ensureLearnerAgent resilience', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        clearSessionCacheForTests();
        process.env = { ...originalEnv };
    });

    it('returns service_unavailable when Memanto agent creation fails', async () => {
        setMemantoFetchForTests(async (url, init = {}) => {
            if (String(url).endsWith('/agents') && init.method === 'POST') {
                return { ok: false, status: 500, json: async () => ({ detail: 'down' }) };
            }
            return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
        });

        const pool = createMockPool();
        const result = await ensureLearnerAgent({ pool, userId: USER_ID });
        assert.equal(result.error_type, 'service_unavailable');
    });
});

describe('recallForLearner session retry', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        clearSessionCacheForTests();
        process.env = { ...originalEnv };
    });

    it('retries recall once after a 401 session error', async () => {
        let recallAttempts = 0;
        let activateAttempts = 0;

        setMemantoFetchForTests(async (url, init = {}) => {
            const path = String(url);
            if (path.endsWith('/activate') && init.method === 'POST') {
                activateAttempts += 1;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        session_token: `token-${activateAttempts}`,
                        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                    }),
                };
            }
            if (path.endsWith('/recall') && init.method === 'POST') {
                recallAttempts += 1;
                if (recallAttempts === 1) {
                    return { ok: false, status: 401, json: async () => ({ detail: 'expired' }) };
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        memories: [{
                            id: 'mem-1',
                            type: 'preference',
                            content: 'Prefers morning sessions',
                            confidence: 0.9,
                            score: 0.55,
                        }],
                    }),
                };
            }
            return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
        });

        const pool = createMockPool({ aiMemoryEnabled: true, metaExists: true });
        const result = await recallForLearner({
            pool,
            userId: USER_ID,
            query: 'learning style',
        });

        assert.equal(result.semantic_memory_status, 'ok');
        assert.equal(result.count, 1);
        assert.equal(recallAttempts, 2);
        assert.equal(activateAttempts, 2);
    });
});

describe('seedAssessmentMemories rollback', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        clearSessionCacheForTests();
        process.env = { ...originalEnv };
    });

    it('does not mark version seeded when a later remember fails', async () => {
        let rememberAttempts = 0;
        const deleted = [];

        setMemantoFetchForTests(async (url, init = {}) => {
            const path = String(url);
            if (path.endsWith('/activate') && init.method === 'POST') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        session_token: 'test-session-token',
                        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                    }),
                };
            }
            if (path.endsWith('/remember') && init.method === 'POST') {
                rememberAttempts += 1;
                if (rememberAttempts >= 3) {
                    return { ok: false, status: 503, json: async () => ({ detail: 'unavailable' }) };
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        memory_id: `mem-${rememberAttempts}`,
                        status: 'queued',
                    }),
                };
            }
            if (path.includes('/memories/') && init.method === 'DELETE') {
                deleted.push(path);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ status: 'deleted' }),
                };
            }
            if (path.endsWith('/agents') && init.method === 'POST') {
                return { ok: true, status: 201, json: async () => ({ agent_id: AGENT_ID }) };
            }
            return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
        });

        const pool = createMockPool({
            aiMemoryEnabled: true,
            metaExists: true,
            assessmentSeedVersion: 1,
        });

        const result = await seedAssessmentMemories({
            pool,
            userId: USER_ID,
            profile: {
                profileVersion: 2,
                assessmentType: 'big_five_v1',
                rawProfile: SPEC_RAW_PROFILE,
                derivedLearningProfile: {},
            },
        });

        assert.equal(result.error_type, 'service_unavailable');
        assert.equal(pool.state.assessmentSeedVersion, 1);
        assert.equal(deleted.length, 2);
    });
});

describe('isMemantoEnabled', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('is false without MEMANTO_API_URL', () => {
        delete process.env.MEMANTO_API_URL;
        delete process.env.MEMANTO_ENABLED;
        assert.equal(isMemantoEnabled(), false);
    });

    it('is true when URL is set', () => {
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        assert.equal(isMemantoEnabled(), true);
    });
});