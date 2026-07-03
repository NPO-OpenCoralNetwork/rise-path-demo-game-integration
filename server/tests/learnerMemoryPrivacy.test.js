import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import learnerMemoryRoutes from '../routes/learnerMemory.js';
import {
    validateAiMemoryPrivacyPatch,
    validateRememberMemoryBody,
    validatePurgeLearnerMemoryBody,
    mapBridgeResultToHttpStatus,
    updateAiMemoryPrivacySettings,
    getAiMemoryPrivacySettings,
} from '../services/learnerMemoryApiService.js';
import {
    setMemantoFetchForTests,
    clearSessionCacheForTests,
} from '../services/learnerMemoryBridge.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { validatePrivacyPreferencesPatch } from '../services/userPreferences.js';

const USER_ID = '14fe15a2-bc4a-4449-afca-f39196f383b1';

function createMockPool({ aiMemoryEnabled = false, preferences = null } = {}) {
    const state = {
        preferences: preferences ?? {
            privacy: {
                ai_memory: {
                    enabled: aiMemoryEnabled,
                    allow_conversation_capture: false,
                },
            },
        },
        savedPreferences: null,
    };

    return {
        state,
        query: async (sql, params = []) => {
            const text = String(sql);
            if (text.includes('FROM user_profiles')) {
                return { rowCount: 1, rows: [{ preferences: state.preferences }] };
            }
            if (text.includes('INSERT INTO user_profiles') || text.includes('ON CONFLICT')) {
                state.savedPreferences = typeof params[1] === 'string'
                    ? JSON.parse(params[1])
                    : params[1];
                return { rowCount: 1, rows: [] };
            }
            if (text.includes('FROM learner_profiles')) {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('SELECT assessment_seed_version')) {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('SELECT memanto_agent_id')) {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('INSERT INTO learner_memory_meta')) {
                return { rowCount: 1, rows: [] };
            }
            if (text.includes('UPDATE learner_memory_meta')) {
                return { rowCount: 1, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        },
    };
}

const withServer = async (handler) => {
    const app = express();
    app.use(express.json());
    app.use('/api/v2', learnerMemoryRoutes);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    try {
        await handler(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
};

describe('validateAiMemoryPrivacyPatch', () => {
    it('accepts boolean fields', () => {
        const result = validateAiMemoryPrivacyPatch({
            enabled: true,
            allow_conversation_capture: false,
        });
        assert.equal(result.valid, true);
    });

    it('rejects non-boolean enabled', () => {
        const result = validateAiMemoryPrivacyPatch({ enabled: 'yes' });
        assert.equal(result.valid, false);
    });
});

describe('validateRememberMemoryBody', () => {
    it('rejects empty content', () => {
        const result = validateRememberMemoryBody({ content: '  ' });
        assert.equal(result.valid, false);
    });

    it('accepts valid remember payload', () => {
        const result = validateRememberMemoryBody({
            content: 'Prefers morning study',
            type: 'preference',
            confidence: 0.9,
        });
        assert.equal(result.valid, true);
    });
});

describe('validatePurgeLearnerMemoryBody', () => {
    it('requires DELETE confirm token', () => {
        assert.equal(validatePurgeLearnerMemoryBody({ confirm: 'NO' }).valid, false);
        assert.equal(validatePurgeLearnerMemoryBody({ confirm: 'DELETE' }).valid, true);
    });
});

describe('mapBridgeResultToHttpStatus', () => {
    it('maps opt-in denial to 403', () => {
        assert.equal(mapBridgeResultToHttpStatus({ error_type: 'ai_memory_not_allowed' }), 403);
    });

    it('maps service_unavailable to 503', () => {
        assert.equal(mapBridgeResultToHttpStatus({ error_type: 'service_unavailable' }), 503);
    });
});

describe('updateAiMemoryPrivacySettings', () => {
    beforeEach(() => {
        resetPoolForTests();
        clearSessionCacheForTests();
    });

    afterEach(() => {
        resetPoolForTests();
    });

    it('forces conversation capture off when disabling ai memory', async () => {
        const pool = createMockPool({
            aiMemoryEnabled: true,
            preferences: {
                privacy: {
                    ai_memory: { enabled: true, allow_conversation_capture: true },
                },
            },
        });
        setPoolForTests(pool);

        const result = await updateAiMemoryPrivacySettings(pool, USER_ID, { enabled: false });
        assert.equal(result.privacy.enabled, false);
        assert.equal(result.privacy.allow_conversation_capture, false);
    });
});

describe('getAiMemoryPrivacySettings', () => {
    it('defaults to disabled', async () => {
        const pool = createMockPool({ aiMemoryEnabled: false });
        const result = await getAiMemoryPrivacySettings(pool, USER_ID);
        assert.deepEqual(result.privacy, {
            enabled: false,
            allow_conversation_capture: false,
        });
    });
});

describe('validatePrivacyPreferencesPatch ai_memory', () => {
    it('accepts ai_memory booleans via user profile path', () => {
        const result = validatePrivacyPreferencesPatch({
            ai_memory: { enabled: true, allow_conversation_capture: false },
        });
        assert.equal(result, null);
    });

    it('rejects invalid ai_memory without life_journal present', () => {
        const result = validatePrivacyPreferencesPatch({
            ai_memory: { enabled: 'yes' },
        });
        assert.ok(result);
        assert.match(result.error, /ai_memory\.enabled/);
    });
});

describe('learner-memory REST opt-in gate', () => {
    const originalToken = process.env.RISE_PATH_BRIDGE_TOKEN;
    const originalDb = process.env.DATABASE_URL_PHASE1;

    beforeEach(() => {
        process.env.RISE_PATH_BRIDGE_TOKEN = 'test-bridge-token';
        delete process.env.DATABASE_URL_PHASE1;
        setPoolForTests(createMockPool({ aiMemoryEnabled: false }));
        setMemantoFetchForTests(async () => {
            throw new Error('Memanto should not be called when opt-in is off');
        });
    });

    afterEach(() => {
        if (originalToken === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
        else process.env.RISE_PATH_BRIDGE_TOKEN = originalToken;
        if (originalDb === undefined) delete process.env.DATABASE_URL_PHASE1;
        else process.env.DATABASE_URL_PHASE1 = originalDb;
        resetPoolForTests();
        setMemantoFetchForTests();
        clearSessionCacheForTests();
    });

    it('returns 403 on POST remember when ai_memory is disabled', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/v2/learner-memory`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-nexloom-bridge-token': 'test-bridge-token',
                },
                body: JSON.stringify({
                    content: 'Likes visual explanations',
                    confidence: 0.9,
                }),
            });

            assert.equal(response.status, 403);
            const payload = await response.json();
            assert.equal(payload.error_type, 'ai_memory_not_allowed');
        });
    });
});