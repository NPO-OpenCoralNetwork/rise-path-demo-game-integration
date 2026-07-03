import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeCard, adjustWeeklyLoad } from '../services/resumeService.js';
import { buildSummaryCards, buildWeeklyDigest, buildMiniEncyclopedia } from '../services/artifactService.js';

// --- Test curriculum fixture ---
const CURRICULUM = {
    title: { jp: 'テストカリキュラム', en: 'Test Curriculum' },
    description: { jp: 'テスト', en: 'Test' },
    modules: [
        {
            module_id: 'm1',
            title: { jp: 'モジュール1', en: 'Module 1' },
            lessons: [
                {
                    lesson_id: 'm1-l1',
                    title: { jp: 'レッスン1', en: 'Lesson 1' },
                    subtitle: { jp: 'サブ', en: 'Sub' },
                    estimated_min: 10,
                    sections: [
                        {
                            id: 'key-points-1',
                            title: { jp: 'ポイント', en: 'Points' },
                            content: [
                                { type: 'list', items: [{ jp: 'ポイント1', en: 'Point 1' }, { jp: 'ポイント2', en: 'Point 2' }], style: 'key' },
                            ],
                        },
                        {
                            id: 'takeaway-2',
                            title: { jp: 'まとめ', en: 'Summary' },
                            content: [
                                { type: 'callout', title: { jp: 'まとめ', en: 'Summary' }, text: { jp: '覚えておこう', en: 'Remember' }, variant: 'success' },
                            ],
                        },
                    ],
                },
                {
                    lesson_id: 'm1-l2',
                    title: { jp: 'レッスン2', en: 'Lesson 2' },
                    estimated_min: 15,
                    sections: [],
                },
            ],
        },
    ],
};

// ===================== Resume Card =====================

describe('buildResumeCard', () => {
    it('returns fresh_start when no progress', () => {
        const card = buildResumeCard({ progress: [], curriculum: CURRICULUM });
        assert.equal(card.type, 'fresh_start');
        assert.ok(card.next_lesson);
        assert.equal(card.next_lesson.lesson_id, 'm1-l1');
    });

    it('returns continue when recent activity', () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
        const progress = [
            { module_id: 'm1', lesson_id: 'm1-l1', status: 'done', doc_completed_at: yesterday.toISOString(), updated_at: yesterday.toISOString() },
        ];
        const card = buildResumeCard({ progress, curriculum: CURRICULUM, now });
        assert.equal(card.type, 'continue');
        assert.equal(card.gap_days, 1);
    });

    it('returns gentle_return after 3-6 day gap', () => {
        const now = new Date();
        const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        const progress = [
            { module_id: 'm1', lesson_id: 'm1-l1', status: 'done', doc_completed_at: fiveDaysAgo.toISOString(), updated_at: fiveDaysAgo.toISOString() },
        ];
        const card = buildResumeCard({ progress, curriculum: CURRICULUM, now });
        assert.equal(card.type, 'gentle_return');
        assert.equal(card.gap_days, 5);
    });

    it('returns recovery after 7+ day gap', () => {
        const now = new Date();
        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
        const progress = [
            { module_id: 'm1', lesson_id: 'm1-l1', status: 'done', doc_completed_at: tenDaysAgo.toISOString(), updated_at: tenDaysAgo.toISOString() },
        ];
        const card = buildResumeCard({ progress, curriculum: CURRICULUM, now });
        assert.equal(card.type, 'recovery');
        assert.ok(card.recovery_plan);
        assert.equal(card.recovery_plan.reduced_load, true);
    });
});

// ===================== Weekly Load =====================

describe('adjustWeeklyLoad', () => {
    it('returns base load when no progress', () => {
        const result = adjustWeeklyLoad({ progress: [], derivedLearningProfile: {}, baseLoadMinutes: 60 });
        assert.equal(result.adjusted_minutes, 60);
        assert.equal(result.adjustment, 'none');
    });

    it('reduces load when stalled', () => {
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const progress = [
            { module_id: 'm1', lesson_id: 'm1-l1', status: 'in_progress', updated_at: twoWeeksAgo },
        ];
        const result = adjustWeeklyLoad({ progress, derivedLearningProfile: {}, baseLoadMinutes: 60 });
        assert.equal(result.adjustment, 'reduced');
        assert.ok(result.adjusted_minutes < 60);
    });

    it('caps load when reassurance_need is high', () => {
        const result = adjustWeeklyLoad({
            progress: [{ status: 'open', updated_at: new Date().toISOString() }],
            derivedLearningProfile: { reassurance_need: 'high' },
            baseLoadMinutes: 120,
        });
        assert.ok(result.adjusted_minutes <= 60);
    });
});

// ===================== Summary Cards =====================

describe('buildSummaryCards', () => {
    it('extracts cards from curriculum', () => {
        const cards = buildSummaryCards({ curriculum: CURRICULUM });
        assert.equal(cards.length, 2);
        assert.equal(cards[0].lesson_id, 'm1-l1');
        assert.ok(cards[0].key_points.length > 0);
        assert.ok(cards[0].takeaway);
    });

    it('handles empty curriculum', () => {
        const cards = buildSummaryCards({ curriculum: {} });
        assert.equal(cards.length, 0);
    });
});

// ===================== Weekly Digest =====================

describe('buildWeeklyDigest', () => {
    it('generates digest with stats', () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
        const progress = [
            { module_id: 'm1', lesson_id: 'm1-l1', status: 'done', doc_completed_at: yesterday.toISOString(), updated_at: yesterday.toISOString() },
        ];
        const digest = buildWeeklyDigest({ curriculum: CURRICULUM, progress, weekNumber: 1 });
        assert.equal(digest.stats.total_lessons, 2);
        assert.equal(digest.stats.completed_lessons, 1);
        assert.equal(digest.stats.completed_this_week, 1);
        assert.ok(digest.next_actions.length > 0);
    });

    it('handles no progress', () => {
        const digest = buildWeeklyDigest({ curriculum: CURRICULUM, progress: [], weekNumber: 1 });
        assert.equal(digest.stats.completed_lessons, 0);
        assert.ok(digest.message.includes('まだ'));
    });
});

// ===================== Mini Encyclopedia =====================

describe('buildMiniEncyclopedia', () => {
    it('generates encyclopedia from curriculum', () => {
        const enc = buildMiniEncyclopedia({ curriculum: CURRICULUM });
        assert.equal(enc.module_count, 1);
        assert.equal(enc.total_lessons, 2);
        assert.equal(enc.entries.length, 1);
        assert.equal(enc.entries[0].lessons.length, 2);
    });
});
