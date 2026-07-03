import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    pearsonCorrelation,
    correlationStrength,
    correlationConfidence,
    computeCorrelations,
    buildAnalysisMetrics,
    detectPatterns,
    analyzeLifeJournal,
    isDayLogged,
    computeCurrentStreak,
} from '../services/lifeJournalAnalysisService.js';
import { deriveLifeHabitSignals } from '../services/personalizationDeriver.js';
import {
    buildWeeklyAdviceFromDays,
    getRollingWeekRange,
    ROLLING_WEEK_DAYS,
} from '../../tools/core/lifeJournalWeekly.js';

const makeDay = (date, overrides = {}) => ({
    date,
    mood: null,
    energy: null,
    focus: null,
    stress: null,
    confidence: null,
    diary_text: null,
    tags: [],
    sleep_hours: null,
    exercise_min: null,
    meals: {},
    total_learning_min: 0,
    journal_entries: 0,
    ...overrides,
});

describe('pearsonCorrelation', () => {
    it('returns 1 for perfect positive linear relationship', () => {
        const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
        assert.ok(Math.abs(r - 1) < 0.001);
    });

    it('returns null for fewer than 2 pairs', () => {
        assert.equal(pearsonCorrelation([1], [2]), null);
    });
});

describe('correlationStrength', () => {
    it('maps moderate correlation', () => {
        assert.equal(correlationStrength(0.45), 'moderate');
        assert.equal(correlationStrength(-0.45), 'moderate');
    });
});

describe('correlationConfidence', () => {
    it('hides below 7 samples', () => {
        assert.equal(correlationConfidence(6), 'hidden');
    });

    it('returns low between 7 and 13', () => {
        assert.equal(correlationConfidence(10), 'low');
    });

    it('returns medium at 14+', () => {
        assert.equal(correlationConfidence(14), 'medium');
    });
});

describe('isDayLogged', () => {
    it('counts partial entries with stress only', () => {
        assert.equal(isDayLogged(makeDay('2026-06-01', { stress: 3 })), true);
    });

    it('ignores completely empty days', () => {
        assert.equal(isDayLogged(makeDay('2026-06-01')), false);
    });
});

describe('computeCurrentStreak', () => {
    it('counts consecutive logged dates ending at anchor', () => {
        const dates = new Set(['2026-06-20', '2026-06-21', '2026-06-22']);
        assert.equal(computeCurrentStreak(dates, '2026-06-22'), 3);
    });
});

describe('buildAnalysisMetrics', () => {
    it('computes sleep threshold and exercise splits', () => {
        const days = [
            makeDay('2026-06-01', { sleep_hours: 5.5, focus: 2, mood: 'okay', exercise_min: 30 }),
            makeDay('2026-06-02', { sleep_hours: 7.5, focus: 4, mood: 'good', exercise_min: 0 }),
            makeDay('2026-06-03', { sleep_hours: 8, focus: 4, mood: 'great', exercise_min: 20 }),
            makeDay('2026-06-04', { sleep_hours: 5, focus: 2, mood: 'struggled', exercise_min: 0 }),
            makeDay('2026-06-05', { sleep_hours: 7, focus: 3, mood: 'good', exercise_min: 15 }),
            makeDay('2026-06-06', { sleep_hours: 6.5, focus: 3, mood: 'okay', exercise_min: 0 }),
            makeDay('2026-06-07', { sleep_hours: 7.2, focus: 4, mood: 'good', exercise_min: 25 }),
        ];
        const metrics = buildAnalysisMetrics(days, { from: '2026-06-01', to: '2026-06-07' });
        assert.equal(metrics.days_logged, 7);
        assert.equal(metrics.insufficient_data, false);
        assert.ok(metrics.sleep_under_6h_days_pct > 0);
        assert.ok(metrics.exercise_days >= 3);
        assert.ok(metrics.avg_focus != null);
    });
});

describe('computeCorrelations', () => {
    it('returns at most 3 correlations when enough data', () => {
        const days = Array.from({ length: 14 }, (_, i) => {
            const sleep = 6 + (i % 3);
            return makeDay(`2026-06-${String(i + 1).padStart(2, '0')}`, {
                sleep_hours: sleep,
                focus: Math.min(5, Math.round(sleep - 2)),
                energy: Math.min(5, sleep),
            });
        });
        const correlations = computeCorrelations(days);
        assert.ok(correlations.length <= 3);
        assert.ok(correlations.every((c) => c.confidence !== 'hidden'));
    });

    it('returns empty when fewer than 7 logged days', () => {
        const days = Array.from({ length: 5 }, (_, i) =>
            makeDay(`2026-06-0${i + 1}`, { sleep_hours: 7, focus: 4 }),
        );
        const analysis = analyzeLifeJournal(days, { from: '2026-06-01', to: '2026-06-05' });
        assert.equal(analysis.correlations.length, 0);
        assert.ok(analysis.data_quality.message);
    });
});

describe('detectPatterns', () => {
    it('detects exercise mood boost when rates diverge', () => {
        const days = [
            ...Array.from({ length: 4 }, (_, i) => makeDay(`2026-06-0${i + 1}`, {
                mood: 'great', exercise_min: 30, focus: 4, sleep_hours: 7,
            })),
            ...Array.from({ length: 4 }, (_, i) => makeDay(`2026-06-1${i}`, {
                mood: 'struggled', exercise_min: 0, focus: 2, sleep_hours: 6,
            })),
        ];
        const metrics = buildAnalysisMetrics(days, { from: '2026-06-01', to: '2026-06-14' });
        const patterns = detectPatterns(days, metrics);
        assert.ok(patterns.some((p) => p.id === 'exercise_mood_boost'));
    });
});

describe('analyzeLifeJournal', () => {
    it('returns summary and data_quality warning', () => {
        const days = Array.from({ length: 10 }, (_, i) =>
            makeDay(`2026-06-${String(i + 1).padStart(2, '0')}`, {
                mood: 'good', focus: 3, sleep_hours: 7, energy: 3,
            }),
        );
        const result = analyzeLifeJournal(days, {
            from: '2026-06-01',
            to: '2026-06-10',
            granularity: 'custom',
        });
        assert.equal(result.ok, true);
        assert.equal(result.summary.days_logged, 10);
        assert.ok(result.data_quality.warning.includes('not causation'));
    });
});

describe('lifeJournalWeekly', () => {
    it('getRollingWeekRange spans 7 inclusive days', () => {
        const range = getRollingWeekRange('2026-06-22');
        assert.equal(range.to, '2026-06-22');
        assert.equal(range.from, '2026-06-16');
        assert.equal(range.days, ROLLING_WEEK_DAYS);
    });

    it('buildWeeklyAdviceFromDays includes record_rate_pct', () => {
        const days = Array.from({ length: 7 }, (_, i) =>
            makeDay(`2026-06-${String(16 + i).padStart(2, '0')}`, {
                mood: 'good', focus: 3, sleep_hours: 7,
            }),
        );
        const result = buildWeeklyAdviceFromDays(days, {
            from: '2026-06-16',
            to: '2026-06-22',
        });
        assert.equal(result.ok, true);
        assert.equal(result.summary.days_logged, 7);
        assert.equal(result.summary.record_rate_pct, 100);
        assert.ok(Array.isArray(result.advice));
    });
});

describe('deriveLifeHabitSignals', () => {
    it('returns empty advice when insufficient data', () => {
        const result = deriveLifeHabitSignals({ insufficient_data: true, days_logged: 3 });
        assert.equal(result.insufficient_data, true);
        assert.equal(result.advice.length, 0);
    });

    it('fires sleep_focus_drop when conditions match including focus delta', () => {
        const metrics = {
            insufficient_data: false,
            days_logged: 14,
            sample_size: 14,
            sleep_under_6h_days_pct: 0.5,
            avg_focus: 2.5,
            focus_delta_sleep_threshold: 0.8,
            avg_sleep_hours: 5.8,
            sleep_under_7h_days_pct: 0.6,
            exercise_days: 2,
            exercise_mood_great_good_pct: 0.4,
            late_meal_rate: 0.1,
        };
        const result = deriveLifeHabitSignals(metrics);
        assert.ok(result.advice.some((a) => a.rule_id === 'sleep_focus_drop'));
    });

    it('does not fire sleep_focus_drop without meaningful focus delta', () => {
        const metrics = {
            insufficient_data: false,
            days_logged: 14,
            sample_size: 14,
            sleep_under_6h_days_pct: 0.5,
            avg_focus: 2.5,
            focus_delta_sleep_threshold: null,
            avg_sleep_hours: 5.8,
            sleep_under_7h_days_pct: 0.6,
            exercise_days: 2,
            exercise_mood_great_good_pct: 0.4,
            late_meal_rate: 0.1,
        };
        const result = deriveLifeHabitSignals(metrics);
        assert.equal(result.advice.some((a) => a.rule_id === 'sleep_focus_drop'), false);
    });

    it('prefers conservative over progressive when both match', () => {
        const metrics = {
            insufficient_data: false,
            days_logged: 14,
            sample_size: 14,
            sleep_under_6h_days_pct: 0.5,
            avg_focus: 2.5,
            focus_delta_sleep_threshold: 1,
            avg_sleep_hours: 5.5,
            sleep_under_7h_days_pct: 0.6,
            exercise_days: 4,
            exercise_mood_great_good_pct: 0.75,
            late_meal_rate: 0.1,
        };
        const result = deriveLifeHabitSignals(metrics);
        const ids = result.advice.map((a) => a.rule_id);
        assert.ok(ids.includes('sleep_focus_drop'));
        assert.equal(ids.includes('exercise_mood_boost'), false);
    });
});