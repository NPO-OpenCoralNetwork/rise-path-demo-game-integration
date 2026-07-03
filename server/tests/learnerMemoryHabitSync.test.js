import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildHabitInsightMemories,
    habitRuleTag,
    syncHabitInsightMemories,
    HABIT_SYNC_INTERVAL_MS,
    setMemantoFetchForTests,
    setHabitAnalysisProviderForTests,
    clearSessionCacheForTests,
} from '../services/learnerMemoryBridge.js';

const USER_ID = '14fe15a2-bc4a-4449-afca-f39196f383b1';
const AGENT_ID = `rp-user-${USER_ID}`;

describe('buildHabitInsightMemories', () => {
    it('returns up to three candidates from correlations and advice', () => {
        const candidates = buildHabitInsightMemories({
            summary: { days_logged: 14 },
            metrics: { insufficient_data: false, days_logged: 14 },
            correlations: [
                {
                    x: 'exercise_min',
                    y: 'focus',
                    label: 'Exercise minutes vs focus',
                    r: 0.38,
                    sample_size: 21,
                    confidence: 'medium',
                },
            ],
            advice: [
                {
                    rule_id: 'sleep_focus_drop',
                    title: 'Sleep and focus',
                    evidence: 'Focus drops on short-sleep days',
                    confidence: 'medium',
                },
                {
                    rule_id: 'exercise_mood_boost',
                    title: 'Exercise mood',
                    evidence: 'Mood improves on exercise days',
                    confidence: 'low',
                },
            ],
        });

        assert.equal(candidates.length, 3);
        assert.equal(candidates[0].type, 'observation');
        assert.match(candidates[0].content, /r=0\.38/);
        assert.ok(candidates[0].tags.includes(habitRuleTag('correlation:exercise_min_focus')));
        assert.equal(candidates[1].rule_id, 'sleep_focus_drop');
        assert.equal(candidates[2].rule_id, 'exercise_mood_boost');
    });

    it('returns empty when insufficient journal data', () => {
        assert.deepEqual(buildHabitInsightMemories({
            summary: { days_logged: 3 },
            metrics: { insufficient_data: true, days_logged: 3 },
        }), []);
    });
});

function createSyncMockPool({
    aiMemoryEnabled = true,
    lastHabitSyncAt = null,
    metaExists = true,
} = {}) {
    const state = {
        lastHabitSyncAt,
        memoryCount: 0,
        preferences: {
            privacy: {
                ai_memory: {
                    enabled: aiMemoryEnabled,
                    allow_conversation_capture: false,
                },
            },
        },
        existingMemories: [],
    };

    return {
        state,
        query: async (sql, params = []) => {
            const text = String(sql);

            if (text.includes('FROM user_profiles')) {
                return { rowCount: 1, rows: [{ preferences: state.preferences }] };
            }

            if (text.includes('SELECT last_habit_sync_at FROM learner_memory_meta')) {
                if (!metaExists) return { rowCount: 0, rows: [] };
                return { rowCount: 1, rows: [{ last_habit_sync_at: state.lastHabitSyncAt }] };
            }

            if (text.includes('SELECT memanto_agent_id FROM learner_memory_meta')) {
                if (!metaExists) return { rowCount: 0, rows: [] };
                return { rowCount: 1, rows: [{ memanto_agent_id: AGENT_ID }] };
            }

            if (text.includes('INSERT INTO learner_memory_meta')) {
                metaExists = true;
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('UPDATE learner_memory_meta') && text.includes('RETURNING')) {
                if (state.lastHabitSyncAt) {
                    const elapsed = Date.now() - new Date(state.lastHabitSyncAt).getTime();
                    if (elapsed < HABIT_SYNC_INTERVAL_MS) {
                        return { rowCount: 0, rows: [] };
                    }
                }
                state.lastHabitSyncAt = new Date().toISOString();
                return { rowCount: 1, rows: [{ user_id: USER_ID }] };
            }

            if (text.includes('UPDATE learner_memory_meta')) {
                if (text.includes('last_habit_sync_at')) {
                    state.lastHabitSyncAt = new Date().toISOString();
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

function createMemantoFetchRecorder({ existingMemoryId = null } = {}) {
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
        if (path.endsWith('/recall/recent') && init.method === 'POST') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    memories: existingMemoryId ? [{
                        id: existingMemoryId,
                        type: 'learning',
                        content: 'Old sleep advice',
                        confidence: 0.75,
                        tags: [habitRuleTag('sleep_focus_drop')],
                    }] : [],
                    count: existingMemoryId ? 1 : 0,
                }),
            };
        }
        if (path.includes('/remember') && init.method === 'POST') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    memory_id: `mem-${calls.length}`,
                    status: 'queued',
                }),
            };
        }
        if (path.includes('/memories/') && init.method === 'DELETE') {
            return { ok: true, status: 200, json: async () => ({ status: 'deleted' }) };
        }

        return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
    };

    return { calls, fetchFn };
}

describe('syncHabitInsightMemories', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clearSessionCacheForTests();
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        setHabitAnalysisProviderForTests();
        clearSessionCacheForTests();
        process.env = { ...originalEnv };
    });

    it('skips when weekly sync is not due', async () => {
        const recent = new Date(Date.now() - (HABIT_SYNC_INTERVAL_MS / 2)).toISOString();
        const pool = createSyncMockPool({ lastHabitSyncAt: recent });

        const result = await syncHabitInsightMemories({ pool, userId: USER_ID, timezone: 'UTC' });
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'sync_not_due');
    });

    it('syncs habit insights and updates existing rule memories with corrected provenance', async () => {
        const { fetchFn, calls } = createMemantoFetchRecorder({ existingMemoryId: 'mem-old' });
        setMemantoFetchForTests(fetchFn);
        const pool = createSyncMockPool({ lastHabitSyncAt: null });

        setHabitAnalysisProviderForTests(async () => ({
            ok: true,
            summary: { days_logged: 14 },
            metrics: { insufficient_data: false, days_logged: 14, sample_size: 14 },
            correlations: [],
            advice: [{
                rule_id: 'sleep_focus_drop',
                title: 'Sleep and focus',
                evidence: 'Focus drops on short-sleep days',
                confidence: 'medium',
            }],
        }));

        const result = await syncHabitInsightMemories({
            pool,
            userId: USER_ID,
            timezone: 'UTC',
            force: true,
        });

        assert.equal(result.synced, true);
        assert.equal(result.count, 1);
        assert.deepEqual(result.updated_rule_ids, ['sleep_focus_drop']);

        const rememberCall = calls.find((call) => String(call.url).includes('/remember'));
        assert.ok(rememberCall);
        const body = JSON.parse(rememberCall.init.body);
        assert.equal(body.provenance, 'corrected');
        assert.equal(body.source, 'habit-sync');

        const deleteCalls = calls.filter((call) => String(call.url).includes('/memories/') && call.init.method === 'DELETE');
        const rememberCalls = calls.filter((call) => String(call.url).includes('/remember'));
        assert.equal(rememberCalls.length, 1);
        assert.equal(deleteCalls.length, 1);
        assert.ok(rememberCalls[0].url < deleteCalls[0].url || calls.indexOf(rememberCalls[0]) < calls.indexOf(deleteCalls[0]));
    });

    it('returns service_unavailable when recent memory list is degraded', async () => {
        setMemantoFetchForTests(async (url) => {
            const path = String(url);
            if (path.endsWith('/recall/recent')) {
                return { ok: false, status: 503, json: async () => ({ detail: 'down' }) };
            }
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
            if (path.includes('/agents/') && !path.includes('/memories/')) {
                return { ok: true, status: 200, json: async () => ({ agent_id: AGENT_ID }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        });

        setHabitAnalysisProviderForTests(async () => ({
            ok: true,
            summary: { days_logged: 14 },
            metrics: { insufficient_data: false, days_logged: 14 },
            correlations: [],
            advice: [{
                rule_id: 'sleep_focus_drop',
                title: 'Sleep and focus',
                evidence: 'Focus drops on short-sleep days',
                confidence: 'medium',
            }],
        }));

        const pool = createSyncMockPool({ lastHabitSyncAt: null });
        const result = await syncHabitInsightMemories({
            pool,
            userId: USER_ID,
            timezone: 'UTC',
            force: true,
        });

        assert.equal(result.error_type, 'service_unavailable');
    });

    it('skips when atomic sync claim is lost', async () => {
        const pool = createSyncMockPool({ lastHabitSyncAt: null });
        const originalQuery = pool.query.bind(pool);
        pool.query = async (sql, params = []) => {
            if (String(sql).includes('RETURNING')) {
                return { rowCount: 0, rows: [] };
            }
            return originalQuery(sql, params);
        };

        setHabitAnalysisProviderForTests(async () => ({
            ok: true,
            summary: { days_logged: 14 },
            metrics: { insufficient_data: false, days_logged: 14 },
            correlations: [],
            advice: [],
        }));

        const result = await syncHabitInsightMemories({
            pool,
            userId: USER_ID,
            timezone: 'UTC',
        });

        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'sync_in_progress');
    });
});