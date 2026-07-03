import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolvePersonalContextPeriod,
    mergeLearnerPersonalContext,
    getLearnerPersonalContext,
    DEFAULT_PERSONAL_CONTEXT_DAYS,
    DEFAULT_RECALL_QUERY,
} from '../../tools/core/learnerMemory.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const chatContextFixture = {
    ok: true,
    period: {
        from: '2026-05-26',
        to: '2026-06-24',
        recorded_days: 18,
        timezone: 'Asia/Tokyo',
    },
    metrics_summary: {
        avg_sleep_hours: 6.9,
        avg_focus: 3.4,
        record_streak: 5,
    },
    top_correlations: [{ pair: 'sleep×focus', r: 0.38, n: 18, confidence: 'medium', strength: 'moderate' }],
    rule_advice: [{ rule_id: 'sleep_focus', title: 'Sleep', action: 'Earlier bedtime', evidence: 'r=0.38', confidence: 0.7, difficulty: 'easy' }],
    assessment_profile: { openness: 80, conscientiousness: 65 },
    assessment_available: true,
    privacy: {
        diary_included: false,
        data_class: 'aggregated_only',
    },
};

describe('resolvePersonalContextPeriod', () => {
    it('defaults to last 30 days ending today in Asia/Tokyo', () => {
        const period = resolvePersonalContextPeriod({ timezone: 'Asia/Tokyo' });
        assert.equal(period.timezone, 'Asia/Tokyo');
        assert.match(period.from, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(period.to, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(period.from <= period.to);

        const fromMs = new Date(`${period.from}T12:00:00Z`).getTime();
        const toMs = new Date(`${period.to}T12:00:00Z`).getTime();
        const spanDays = Math.floor((toMs - fromMs) / 86400000) + 1;
        assert.equal(spanDays, DEFAULT_PERSONAL_CONTEXT_DAYS);
    });

    it('preserves explicit from/to', () => {
        const period = resolvePersonalContextPeriod({
            from: '2026-06-01',
            to: '2026-06-15',
            timezone: 'UTC',
        });
        assert.equal(period.from, '2026-06-01');
        assert.equal(period.to, '2026-06-15');
        assert.equal(period.timezone, 'UTC');
    });
});

describe('mergeLearnerPersonalContext', () => {
    it('merges L3 chat context with semantic memories when recall is ok', () => {
        const merged = mergeLearnerPersonalContext(chatContextFixture, {
            semantic_memory_status: 'ok',
            memories: [{
                type: 'preference',
                content: 'Prefers visual step-by-step explanations',
                confidence: 0.9,
                score: 0.55,
            }],
        }, { aiMemoryEnabled: true });

        assert.equal(merged.ok, true);
        assert.equal(merged.semantic_memory_status, 'ok');
        assert.equal(merged.semantic_memories.length, 1);
        assert.equal(merged.semantic_memories[0].type, 'preference');
        assert.equal(merged.privacy.ai_memory_included, true);
        assert.equal(merged.privacy.data_class, 'aggregated_with_semantic_memory');
        assert.equal(merged.assessment_available, true);
        assert.deepEqual(merged.top_correlations, chatContextFixture.top_correlations);
    });

    it('returns disabled semantic status when opt-in is off', () => {
        const merged = mergeLearnerPersonalContext(chatContextFixture, {
            semantic_memory_status: 'disabled',
            memories: [],
        }, { aiMemoryEnabled: false });

        assert.equal(merged.semantic_memory_status, 'disabled');
        assert.equal(merged.semantic_memories.length, 0);
        assert.equal(merged.privacy.ai_memory_included, false);
        assert.equal(merged.privacy.data_class, 'aggregated_only');
    });

    it('returns degraded semantic status with empty memories when Memanto is unavailable', () => {
        const merged = mergeLearnerPersonalContext(chatContextFixture, {
            semantic_memory_status: 'degraded',
            memories: [],
        }, { aiMemoryEnabled: true });

        assert.equal(merged.semantic_memory_status, 'degraded');
        assert.equal(merged.semantic_memories.length, 0);
        assert.equal(merged.privacy.ai_memory_included, false);
        assert.equal(merged.privacy.diary_included, false);
        assert.equal(merged.metrics_summary.avg_focus, 3.4);
    });

    it('propagates chat context validation errors', () => {
        const merged = mergeLearnerPersonalContext({
            error: 'Invalid date range',
            error_type: 'validation',
        }, { semantic_memory_status: 'ok', memories: [] });

        assert.equal(merged.error_type, 'validation');
    });

    it('uses default recall query constant in spec', () => {
        assert.match(DEFAULT_RECALL_QUERY, /learning preferences/i);
    });
});

describe('getLearnerPersonalContext', () => {
    afterEach(() => {
        resetPoolForTests();
    });

    it('returns db_connection when pool is missing', async () => {
        setPoolForTests(null);
        const result = await getLearnerPersonalContext({ userId: '00000000-0000-0000-0000-000000000001' });
        assert.equal(result.error_type, 'db_connection');
    });
});