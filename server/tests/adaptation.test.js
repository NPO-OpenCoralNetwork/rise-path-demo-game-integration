import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJournalPatterns } from '../services/journalService.js';
import { deriveAdaptationSignals } from '../services/personalizationDeriver.js';

// --- Test helpers ---

const makeEntry = (overrides = {}, daysAgo = 0) => ({
    module_id: 'mod-1',
    lesson_id: `lesson-${Math.random().toString(36).slice(2, 6)}`,
    mood: 'good',
    confidence: 3,
    time_spent_min: 30,
    learned: 'Something useful',
    created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    ...overrides,
});

const makeEntries = (count, overrides = {}, daysAgo = 0) =>
    Array.from({ length: count }, (_, i) => makeEntry(overrides, daysAgo + i));

// ===================== analyzeJournalPatterns =====================

describe('analyzeJournalPatterns', () => {
    it('returns insufficient_data when fewer than 3 entries', () => {
        const result = analyzeJournalPatterns([makeEntry(), makeEntry()]);
        assert.equal(result.insufficient_data, true);
        assert.equal(result.entries_available, 2);
    });

    it('returns insufficient_data for empty array', () => {
        const result = analyzeJournalPatterns([]);
        assert.equal(result.insufficient_data, true);
        assert.equal(result.entries_available, 0);
    });

    it('counts struggled_streak correctly', () => {
        const entries = [
            makeEntry({ mood: 'struggled' }),
            makeEntry({ mood: 'struggled' }),
            makeEntry({ mood: 'struggled' }),
            makeEntry({ mood: 'good' }),
            makeEntry({ mood: 'struggled' }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.struggled_streak, 3);
    });

    it('struggled_streak is 0 when first entry is not struggled', () => {
        const entries = [
            makeEntry({ mood: 'good' }),
            makeEntry({ mood: 'struggled' }),
            makeEntry({ mood: 'struggled' }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.struggled_streak, 0);
    });

    it('calculates mood_great_good_pct', () => {
        const entries = [
            makeEntry({ mood: 'great' }),
            makeEntry({ mood: 'good' }),
            makeEntry({ mood: 'good' }),
            makeEntry({ mood: 'okay' }),
            makeEntry({ mood: 'struggled' }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.mood_great_good_pct, 0.6);
    });

    it('calculates avg_confidence', () => {
        const entries = [
            makeEntry({ confidence: 2 }),
            makeEntry({ confidence: 3 }),
            makeEntry({ confidence: 4 }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.avg_confidence, 3);
    });

    it('returns null avg_confidence when no confidence data', () => {
        const entries = makeEntries(3, { confidence: undefined });
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.avg_confidence, null);
    });

    it('detects declining confidence trend with 6+ entries', () => {
        const entries = [
            // recent 3 (lower)
            makeEntry({ confidence: 2 }),
            makeEntry({ confidence: 2 }),
            makeEntry({ confidence: 1 }),
            // older 3 (higher)
            makeEntry({ confidence: 4 }),
            makeEntry({ confidence: 4 }),
            makeEntry({ confidence: 5 }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.confidence_trend, 'declining');
    });

    it('detects rough declining trend with 3-5 entries', () => {
        const entries = [
            makeEntry({ confidence: 1 }),
            makeEntry({ confidence: 3 }),
            makeEntry({ confidence: 4 }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.confidence_trend, 'declining');
    });

    it('detects stable trend', () => {
        const entries = [
            makeEntry({ confidence: 3 }),
            makeEntry({ confidence: 3 }),
            makeEntry({ confidence: 3 }),
            makeEntry({ confidence: 3 }),
            makeEntry({ confidence: 3 }),
            makeEntry({ confidence: 3 }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.confidence_trend, 'stable');
    });

    it('counts lessons_without_learned', () => {
        const entries = [
            makeEntry({ learned: '' }),
            makeEntry({ learned: '  ' }),
            makeEntry({ learned: '' }),
            makeEntry({ learned: 'Got it' }),
        ];
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.lessons_without_learned, 3);
    });

    it('filters by module_id', () => {
        const entries = [
            makeEntry({ module_id: 'mod-A', mood: 'struggled' }),
            makeEntry({ module_id: 'mod-A', mood: 'struggled' }),
            makeEntry({ module_id: 'mod-B', mood: 'great' }),
            makeEntry({ module_id: 'mod-A', mood: 'good' }),
        ];
        const result = analyzeJournalPatterns(entries, { module_id: 'mod-A' });
        assert.equal(result.struggled_streak, 2);
        assert.equal(result.module_id, 'mod-A');
    });

    it('respects window option', () => {
        const entries = makeEntries(20, { mood: 'struggled' });
        const result = analyzeJournalPatterns(entries, { window: 5 });
        assert.equal(result.total_entries, 5);
    });

    it('includes confidence_score based on entry count', () => {
        assert.equal(analyzeJournalPatterns(makeEntries(3)).confidence_score, 0.4);
        assert.equal(analyzeJournalPatterns(makeEntries(5)).confidence_score, 0.4);
        assert.equal(analyzeJournalPatterns(makeEntries(6)).confidence_score, 0.7);
        assert.equal(analyzeJournalPatterns(makeEntries(10)).confidence_score, 1.0);
    });

    it('returns fresh staleness for recent entries', () => {
        const entries = makeEntries(3, {}, 0); // today
        const result = analyzeJournalPatterns(entries);
        assert.equal(result.staleness, 'fresh');
    });
});

// ===================== deriveAdaptationSignals =====================

describe('deriveAdaptationSignals', () => {
    it('returns empty for insufficient_data', () => {
        const result = deriveAdaptationSignals({ insufficient_data: true, entries_available: 1 });
        assert.equal(result.signals.length, 0);
        assert.ok(result.analysis.insufficient_data);
    });

    it('returns welcome_back for stale data', () => {
        const patterns = analyzeJournalPatterns(makeEntries(5, {}, 10)); // 10+ days ago
        const result = deriveAdaptationSignals(patterns);
        assert.equal(result.signals.length, 0);
        assert.ok(result.welcome_back);
        assert.equal(result.analysis.staleness, 'stale');
    });

    it('fires pace_down on struggled_streak >= 2', () => {
        const entries = [
            makeEntry({ mood: 'struggled' }),
            makeEntry({ mood: 'struggled' }),
            makeEntry({ mood: 'good' }),
        ];
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.ok(result.signals.some(s => s.type === 'pace_down'));
        assert.equal(result.generation_rule_overrides.pace_preference, 'steady_small_steps');
    });

    it('fires encourage on low avg_confidence', () => {
        const entries = makeEntries(5, { confidence: 2 });
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.ok(result.signals.some(s => s.type === 'encourage'));
        assert.equal(result.generation_rule_overrides.reassurance_need, 'high');
    });

    it('does NOT fire encourage when confidence is null', () => {
        const entries = makeEntries(5, { confidence: undefined });
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.ok(!result.signals.some(s => s.type === 'encourage'));
    });

    it('fires level_up on great mood + high confidence', () => {
        const entries = makeEntries(10, { mood: 'great', confidence: 5 });
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.ok(result.signals.some(s => s.type === 'level_up'));
    });

    it('resolves conflict: pace_down wins over level_up', () => {
        // 2 struggled + 9 great = 11 entries, great_good_pct = 9/11 = 0.818
        const entries = [
            makeEntry({ mood: 'struggled', confidence: 5 }),
            makeEntry({ mood: 'struggled', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
            makeEntry({ mood: 'great', confidence: 5 }),
        ];
        const patterns = analyzeJournalPatterns(entries, { window: 11 });
        assert.ok(patterns.struggled_streak >= 2);
        assert.ok(patterns.mood_great_good_pct > 0.8);
        assert.ok(patterns.avg_confidence > 4);

        const result = deriveAdaptationSignals(patterns);
        assert.ok(result.signals.some(s => s.type === 'pace_down'));
        assert.ok(!result.signals.some(s => s.type === 'level_up'));
    });

    it('fires engagement_drop on lessons_without_learned >= 3', () => {
        const entries = [
            makeEntry({ learned: '' }),
            makeEntry({ learned: '' }),
            makeEntry({ learned: '' }),
        ];
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.ok(result.signals.some(s => s.type === 'engagement_drop'));
    });

    it('includes confidence in each signal', () => {
        const entries = makeEntries(5, { mood: 'struggled', confidence: 2 });
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        for (const sig of result.signals) {
            assert.equal(typeof sig.confidence, 'number');
            assert.ok(sig.confidence > 0 && sig.confidence <= 1);
        }
    });

    it('includes confidence_score and staleness in analysis', () => {
        const entries = makeEntries(5, { mood: 'good' });
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.equal(typeof result.analysis.confidence_score, 'number');
        assert.ok(['fresh', 'recent', 'stale'].includes(result.analysis.staleness));
    });

    it('returns no signals when everything is normal', () => {
        const entries = makeEntries(10, { mood: 'good', confidence: 3, time_spent_min: 25, learned: 'something' });
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.equal(result.signals.length, 0);
        assert.deepEqual(result.generation_rule_overrides, {});
    });
});

// ===================== evaluateCondition edge cases =====================

describe('Rule engine edge cases', () => {
    it('does not fire any rule on 3 normal entries', () => {
        const entries = makeEntries(3, { mood: 'okay', confidence: 3, time_spent_min: 20, learned: 'yes' });
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        assert.equal(result.signals.length, 0);
    });

    it('fires multiple non-conflicting signals', () => {
        const entries = [
            makeEntry({ mood: 'struggled', confidence: 1, learned: '' }),
            makeEntry({ mood: 'struggled', confidence: 2, learned: '' }),
            makeEntry({ mood: 'okay', confidence: 2, learned: '' }),
        ];
        const patterns = analyzeJournalPatterns(entries);
        const result = deriveAdaptationSignals(patterns);
        const types = result.signals.map(s => s.type);
        assert.ok(types.includes('pace_down'));
        assert.ok(types.includes('encourage'));
        assert.ok(types.includes('engagement_drop'));
    });
});

// ===================== suggestLearningMode =====================

import { suggestLearningMode } from '../../tools/core/curriculum.js';

describe('suggestLearningMode', () => {
    it('returns gentle when reassurance_need is high', () => {
        assert.equal(suggestLearningMode({ reassurance_need: 'high' }), 'gentle');
    });

    it('returns credential when credential_orientation is high', () => {
        assert.equal(suggestLearningMode({ credential_orientation: 'high' }), 'credential');
    });

    it('returns problem_solving when problem_solving_orientation is high', () => {
        assert.equal(suggestLearningMode({ problem_solving_orientation: 'high' }), 'problem_solving');
    });

    it('returns practice when practice_intensity is heavy', () => {
        assert.equal(suggestLearningMode({ practice_intensity: 'heavy' }), 'practice');
    });

    it('returns default when no conditions met', () => {
        assert.equal(suggestLearningMode({ reassurance_need: 'low', credential_orientation: 'medium' }), 'default');
    });

    it('gentle wins over credential (priority order)', () => {
        assert.equal(suggestLearningMode({
            reassurance_need: 'high',
            credential_orientation: 'high',
        }), 'gentle');
    });

    it('returns default for null input', () => {
        assert.equal(suggestLearningMode(null), 'default');
    });

    it('returns default for empty object', () => {
        assert.equal(suggestLearningMode({}), 'default');
    });
});
