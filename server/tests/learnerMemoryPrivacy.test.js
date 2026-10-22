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
    buildSemanticMemoriesExportSection,
} from '../services/learnerMemoryApiService.js';
import {
    setMemantoFetchForTests,
    clearSessionCacheForTests,
} from '../services/learnerMemoryBridge.js';
import { setPoolForTests, resetPoolForTests, PHASE1_USER_ID } from '../db.js';
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
        deletedMetaUserIds: [],
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
            if (text.includes('DELETE FROM learner_memory_meta')) {
                state.deletedMetaUserIds.push(params[0]);
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

    it('maps ai_memory_not_offered to 409', () => {
        assert.equal(mapBridgeResultToHttpStatus({ error_type: 'ai_memory_not_offered' }), 409);
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

describe('AI memory availability (Memanto configured or not)', () => {
    const originalEnv = { ...process.env };

    const memantoOff = () => {
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'false';
    };
    const memantoOn = () => {
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    };

    beforeEach(() => {
        resetPoolForTests();
        clearSessionCacheForTests();
        setMemantoFetchForTests(async () => {
            throw new Error('Memanto should not be called by privacy settings');
        });
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        resetPoolForTests();
        setMemantoFetchForTests();
        clearSessionCacheForTests();
    });

    it('reports available: false when Memanto is off', async () => {
        memantoOff();
        const result = await getAiMemoryPrivacySettings(createMockPool(), USER_ID);
        assert.equal(result.ok, true);
        assert.equal(result.available, false);
    });

    it('reports available: false when MEMANTO_API_URL is missing', async () => {
        delete process.env.MEMANTO_API_URL;
        delete process.env.MEMANTO_ENABLED;
        const result = await getAiMemoryPrivacySettings(createMockPool(), USER_ID);
        assert.equal(result.available, false);
    });

    it('reports available: true when Memanto is on', async () => {
        memantoOn();
        const result = await getAiMemoryPrivacySettings(createMockPool(), USER_ID);
        assert.equal(result.available, true);
    });

    it('refuses to turn ai memory on when Memanto is off and saves nothing', async () => {
        memantoOff();
        const pool = createMockPool({ aiMemoryEnabled: false });
        const result = await updateAiMemoryPrivacySettings(pool, USER_ID, {
            enabled: true,
            allow_conversation_capture: false,
        });
        assert.equal(result.error_type, 'ai_memory_not_offered');
        assert.equal(mapBridgeResultToHttpStatus(result), 409);
        assert.equal(pool.state.savedPreferences, null);
    });

    it('refuses to turn conversation capture on when Memanto is off', async () => {
        memantoOff();
        const pool = createMockPool({ aiMemoryEnabled: true });
        const result = await updateAiMemoryPrivacySettings(pool, USER_ID, {
            allow_conversation_capture: true,
        });
        assert.equal(result.error_type, 'ai_memory_not_offered');
        assert.equal(pool.state.savedPreferences, null);
    });

    it('allows turning ai memory off when Memanto is off', async () => {
        memantoOff();
        const pool = createMockPool({
            preferences: {
                privacy: { ai_memory: { enabled: true, allow_conversation_capture: true } },
            },
        });
        const result = await updateAiMemoryPrivacySettings(pool, USER_ID, {
            enabled: false,
            allow_conversation_capture: false,
        });
        assert.equal(result.ok, true);
        assert.equal(result.available, false);
        assert.deepEqual(result.privacy, { enabled: false, allow_conversation_capture: false });
        assert.equal(pool.state.savedPreferences.privacy.ai_memory.enabled, false);
    });

    it('allows turning capture off for an earlier opt-in when Memanto is off', async () => {
        memantoOff();
        const pool = createMockPool({
            preferences: {
                privacy: { ai_memory: { enabled: true, allow_conversation_capture: true } },
            },
        });
        // The UI always sends the whole state, so enabled:true comes along unchanged.
        const result = await updateAiMemoryPrivacySettings(pool, USER_ID, {
            enabled: true,
            allow_conversation_capture: false,
        });
        assert.equal(result.ok, true);
        assert.equal(result.privacy.allow_conversation_capture, false);
        assert.equal(pool.state.savedPreferences.privacy.ai_memory.allow_conversation_capture, false);
    });

    it('does not refuse re-saving the same opt-in when Memanto is off', async () => {
        memantoOff();
        const pool = createMockPool({
            preferences: {
                privacy: { ai_memory: { enabled: true, allow_conversation_capture: true } },
            },
        });
        const result = await updateAiMemoryPrivacySettings(pool, USER_ID, {
            enabled: true,
            allow_conversation_capture: true,
        });
        assert.equal(result.ok, true);
        assert.deepEqual(result.privacy, { enabled: true, allow_conversation_capture: true });
        assert.equal(result.seed_triggered, false);
    });

    it('allows turning ai memory on when Memanto is on', async () => {
        memantoOn();
        const pool = createMockPool({ aiMemoryEnabled: false });
        const result = await updateAiMemoryPrivacySettings(pool, USER_ID, {
            enabled: true,
            allow_conversation_capture: true,
        });
        assert.equal(result.ok, true);
        assert.equal(result.available, true);
        assert.deepEqual(result.privacy, { enabled: true, allow_conversation_capture: true });
        assert.equal(result.seed_triggered, true);
    });

    it('exports semantic memories with not_configured status when Memanto is off', async () => {
        memantoOff();
        const pool = createMockPool({ aiMemoryEnabled: true });
        const section = await buildSemanticMemoriesExportSection({ pool, userId: USER_ID });
        assert.equal(section.count, 0);
        assert.deepEqual(section.items, []);
        assert.equal(section.semantic_memory_status, 'not_configured');
    });

    describe('REST', () => {
        const headers = {
            'Content-Type': 'application/json',
            'x-nexloom-bridge-token': 'test-bridge-token',
        };

        beforeEach(() => {
            process.env.RISE_PATH_BRIDGE_TOKEN = 'test-bridge-token';
            delete process.env.DATABASE_URL_PHASE1;
        });

        it('GET privacy returns available: false and PUT enabled:true returns 409 when Memanto is off', async () => {
            memantoOff();
            const pool = createMockPool({ aiMemoryEnabled: false });
            setPoolForTests(pool);
            await withServer(async (baseUrl) => {
                const got = await fetch(`${baseUrl}/api/v2/learner-memory/privacy`, { headers });
                assert.equal(got.status, 200);
                const gotBody = await got.json();
                assert.equal(gotBody.available, false);
                assert.deepEqual(gotBody.privacy, { enabled: false, allow_conversation_capture: false });

                const put = await fetch(`${baseUrl}/api/v2/learner-memory/privacy`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ enabled: true, allow_conversation_capture: false }),
                });
                assert.equal(put.status, 409);
                const putBody = await put.json();
                assert.equal(putBody.error_type, 'ai_memory_not_offered');

                const off = await fetch(`${baseUrl}/api/v2/learner-memory/privacy`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ enabled: false, allow_conversation_capture: false }),
                });
                assert.equal(off.status, 200);
            });
            assert.equal(pool.state.savedPreferences.privacy.ai_memory.enabled, false);
        });

        it('DELETE purges an earlier opt-in learner when Memanto is off', async () => {
            memantoOff();
            const pool = createMockPool({ aiMemoryEnabled: true });
            setPoolForTests(pool);
            await withServer(async (baseUrl) => {
                const purged = await fetch(`${baseUrl}/api/v2/learner-memory`, {
                    method: 'DELETE',
                    headers,
                    body: JSON.stringify({ confirm: 'DELETE' }),
                });
                assert.equal(purged.status, 200);
                const body = await purged.json();
                assert.equal(body.status, 'purged');
            });
            // The bridge token acts as the Phase 1 user.
            assert.deepEqual(pool.state.deletedMetaUserIds, [PHASE1_USER_ID]);
        });

        it('GET list returns not_configured status when Memanto is off', async () => {
            memantoOff();
            setPoolForTests(createMockPool({ aiMemoryEnabled: true }));
            await withServer(async (baseUrl) => {
                const listed = await fetch(`${baseUrl}/api/v2/learner-memory`, { headers });
                assert.equal(listed.status, 200);
                const body = await listed.json();
                assert.equal(body.count, 0);
                assert.equal(body.semantic_memory_status, 'not_configured');
            });
        });

        it('PUT enabled:true succeeds when Memanto is on', async () => {
            memantoOn();
            setPoolForTests(createMockPool({ aiMemoryEnabled: false }));
            await withServer(async (baseUrl) => {
                const put = await fetch(`${baseUrl}/api/v2/learner-memory/privacy`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ enabled: true, allow_conversation_capture: false }),
                });
                assert.equal(put.status, 200);
                const body = await put.json();
                assert.equal(body.privacy.enabled, true);
                assert.equal(body.available, true);
            });
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