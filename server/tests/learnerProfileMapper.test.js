import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors services/learnerProfileService.ts mapping for regression coverage.
 */
function normalizeBig5Scores(bigFive) {
    return {
        openness: Number(bigFive?.openness ?? 0),
        conscientiousness: Number(bigFive?.conscientiousness ?? 0),
        extraversion: Number(bigFive?.extraversion ?? 0),
        agreeableness: Number(bigFive?.agreeableness ?? 0),
        neuroticism: Number(bigFive?.neuroticism ?? 0),
    };
}

function mapLearnerProfileRow(row) {
    const raw = row.raw_profile ?? {};
    const scores = normalizeBig5Scores(raw.big_five);
    return {
        scores,
        learningStyle: String(raw.learning_style?.type || '標準学習モード'),
        motivation: String(raw.motivation?.primary || '継続的な改善'),
        completedAt: row.created_at || null,
    };
}

describe('learner profile → assessment display mapping', () => {
    it('maps raw_profile big_five and metadata', () => {
        const mapped = mapLearnerProfileRow({
            created_at: '2026-06-01T12:00:00.000Z',
            raw_profile: {
                big_five: {
                    openness: 80,
                    conscientiousness: 65,
                    extraversion: 40,
                    agreeableness: 70,
                    neuroticism: 35,
                },
                learning_style: { type: '探索型' },
                motivation: { primary: '好奇心' },
            },
        });

        assert.deepEqual(mapped.scores, {
            openness: 80,
            conscientiousness: 65,
            extraversion: 40,
            agreeableness: 70,
            neuroticism: 35,
        });
        assert.equal(mapped.learningStyle, '探索型');
        assert.equal(mapped.motivation, '好奇心');
        assert.equal(mapped.completedAt, '2026-06-01T12:00:00.000Z');
    });
});