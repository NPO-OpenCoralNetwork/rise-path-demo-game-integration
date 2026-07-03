import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDiaryExcerpts,
    extractAssessmentProfile,
    buildChatContext,
} from '../../tools/core/lifeJournal.js';
import { analyzeLifeJournal } from '../../tools/core/lifeJournalAnalysis.js';
import { deriveLifeHabitSignals } from '../../tools/core/lifeHabitRules.js';

const makeDay = (date, overrides = {}) => ({
    date,
    mood: 'good',
    focus: 3,
    sleep_hours: 7,
    exercise_min: 0,
    diary_text: null,
    total_learning_min: 30,
    ...overrides,
});

describe('buildDiaryExcerpts', () => {
    it('returns truncated excerpts sorted by date descending', () => {
        const long = 'a'.repeat(200);
        const excerpts = buildDiaryExcerpts([
            makeDay('2026-06-01', { diary_text: 'older entry' }),
            makeDay('2026-06-03', { diary_text: long }),
            makeDay('2026-06-02', { diary_text: 'middle' }),
        ]);
        assert.equal(excerpts.length, 3);
        assert.equal(excerpts[0].date, '2026-06-03');
        assert.equal(excerpts[0].excerpt.length, 160);
        assert.equal(excerpts[2].date, '2026-06-01');
    });

    it('skips days without diary_text', () => {
        const excerpts = buildDiaryExcerpts([
            makeDay('2026-06-01'),
            makeDay('2026-06-02', { diary_text: '  note  ' }),
        ]);
        assert.equal(excerpts.length, 1);
        assert.equal(excerpts[0].excerpt, 'note');
    });
});

describe('extractAssessmentProfile', () => {
    it('extracts big_five traits when profile exists', () => {
        const profile = extractAssessmentProfile({
            found: true,
            raw_profile: {
                big_five: {
                    openness: 80,
                    conscientiousness: 65,
                    extraversion: 40,
                    agreeableness: 70,
                    neuroticism: 35,
                },
            },
        });
        assert.deepEqual(profile, {
            openness: 80,
            conscientiousness: 65,
            extraversion: 40,
            agreeableness: 70,
            neuroticism: 35,
        });
    });

    it('returns null when no profile', () => {
        assert.equal(extractAssessmentProfile({ found: false }), null);
        assert.equal(extractAssessmentProfile(null), null);
    });
});

describe('buildChatContext', () => {
    it('builds aggregated-only context without diary excerpts by default', () => {
        const days = [];
        for (let i = 1; i <= 10; i += 1) {
            const d = String(i).padStart(2, '0');
            days.push(makeDay(`2026-06-${d}`, {
                sleep_hours: 6 + (i % 3),
                focus: 2 + (i % 3),
                exercise_min: i % 2 === 0 ? 30 : 0,
                diary_text: i === 10 ? 'felt focused after walk' : null,
            }));
        }

        const analysis = analyzeLifeJournal(days, {
            from: '2026-06-01',
            to: '2026-06-10',
        });
        const habitSignals = deriveLifeHabitSignals(analysis.metrics);
        analysis.advice = habitSignals.advice;

        const ctx = buildChatContext({
            from: '2026-06-01',
            to: '2026-06-10',
            timezone: 'Asia/Tokyo',
            analysis,
            adviceResult: { advice: habitSignals.advice },
            assessmentProfile: { neuroticism: 35 },
            includeDiaryExcerpts: false,
            days,
        });

        assert.equal(ctx.ok, true);
        assert.equal(ctx.period.recorded_days, 10);
        assert.equal(ctx.assessment_available, true);
        assert.deepEqual(ctx.diary_excerpts, []);
        assert.equal(ctx.privacy.diary_included, false);
        assert.equal(ctx.privacy.data_class, 'aggregated_only');
        assert.ok(Array.isArray(ctx.top_correlations));
        assert.ok(Array.isArray(ctx.rule_advice));
        assert.ok(ctx.metrics_summary.avg_sleep_hours != null);
    });

    it('includes diary excerpts when opted in', () => {
        const days = [
            makeDay('2026-06-01', { diary_text: 'slept well' }),
        ];
        const analysis = analyzeLifeJournal(days, { from: '2026-06-01', to: '2026-06-01' });

        const ctx = buildChatContext({
            from: '2026-06-01',
            to: '2026-06-01',
            timezone: 'Asia/Tokyo',
            analysis,
            adviceResult: { advice: [] },
            assessmentProfile: null,
            includeDiaryExcerpts: true,
            days,
        });

        assert.equal(ctx.privacy.diary_included, true);
        assert.equal(ctx.diary_excerpts.length, 1);
        assert.equal(ctx.diary_excerpts[0].excerpt, 'slept well');
    });
});