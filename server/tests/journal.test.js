import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateJournalEntry, buildJournalSummary } from '../services/journalService.js';

// ===================== Validation =====================

describe('validateJournalEntry', () => {
    it('accepts valid entry with all fields', () => {
        const result = validateJournalEntry({
            curriculum_id: 'abc',
            module_id: 'm1',
            lesson_id: 'm1-l1',
            learned: 'Variables are labels',
            difficulty: 'Mutable vs immutable',
            mood: 'good',
            confidence: 4,
            time_spent_min: 15,
        });
        assert.equal(result.valid, true);
    });

    it('accepts entry with only mood', () => {
        const result = validateJournalEntry({
            curriculum_id: 'abc',
            module_id: 'm1',
            lesson_id: 'm1-l1',
            mood: 'great',
        });
        assert.equal(result.valid, true);
    });

    it('rejects entry with no content', () => {
        const result = validateJournalEntry({
            curriculum_id: 'abc',
            module_id: 'm1',
            lesson_id: 'm1-l1',
        });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('At least one')));
    });

    it('rejects invalid mood', () => {
        const result = validateJournalEntry({
            curriculum_id: 'abc',
            module_id: 'm1',
            lesson_id: 'm1-l1',
            mood: 'amazing',
        });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('mood')));
    });

    it('rejects confidence out of range', () => {
        const result = validateJournalEntry({
            curriculum_id: 'abc',
            module_id: 'm1',
            lesson_id: 'm1-l1',
            confidence: 6,
        });
        assert.equal(result.valid, false);
    });

    it('rejects missing curriculum_id', () => {
        const result = validateJournalEntry({
            module_id: 'm1',
            lesson_id: 'm1-l1',
            learned: 'Something',
        });
        assert.equal(result.valid, false);
    });
});

// ===================== Summary =====================

describe('buildJournalSummary', () => {
    it('returns empty summary for no entries', () => {
        const summary = buildJournalSummary({ entries: [] });
        assert.equal(summary.total_entries, 0);
        assert.equal(summary.avg_confidence, null);
        assert.equal(summary.total_time_min, 0);
        assert.equal(summary.recent.length, 0);
    });

    it('computes mood distribution', () => {
        const entries = [
            { mood: 'great', confidence: 5, lesson_id: 'l1', module_id: 'm1', created_at: new Date().toISOString() },
            { mood: 'good', confidence: 4, lesson_id: 'l2', module_id: 'm1', created_at: new Date().toISOString() },
            { mood: 'great', confidence: 3, lesson_id: 'l3', module_id: 'm1', created_at: new Date().toISOString() },
        ];
        const summary = buildJournalSummary({ entries });
        assert.equal(summary.total_entries, 3);
        assert.equal(summary.mood_distribution.great, 2);
        assert.equal(summary.mood_distribution.good, 1);
        assert.equal(summary.mood_distribution.struggled, 0);
        assert.equal(summary.avg_confidence, 4);
    });

    it('limits recent to 5 entries', () => {
        const entries = Array.from({ length: 8 }, (_, i) => ({
            lesson_id: `l${i}`,
            module_id: 'm1',
            mood: 'okay',
            created_at: new Date(Date.now() - i * 86400000).toISOString(),
        }));
        const summary = buildJournalSummary({ entries });
        assert.equal(summary.recent.length, 5);
    });

    it('sums time_spent_min', () => {
        const entries = [
            { lesson_id: 'l1', module_id: 'm1', time_spent_min: 10, mood: 'good', created_at: new Date().toISOString() },
            { lesson_id: 'l2', module_id: 'm1', time_spent_min: 20, mood: 'good', created_at: new Date().toISOString() },
        ];
        const summary = buildJournalSummary({ entries });
        assert.equal(summary.total_time_min, 30);
    });
});
