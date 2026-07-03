import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recommendVoiceIdFromProfile } from '../../data/tts/voiceRecommendationsCore.js';

describe('recommendVoiceIdFromProfile', () => {
    it('returns default when scores missing', () => {
        assert.equal(recommendVoiceIdFromProfile(null, null), 'jf_alpha');
    });

    it('prefers storyteller when openness is high', () => {
        assert.equal(
            recommendVoiceIdFromProfile({ openness: 70, extraversion: 40, agreeableness: 40 }, null),
            'jf_tebukuro',
        );
    });

    it('prefers lumina when agreeableness is high and openness low', () => {
        assert.equal(
            recommendVoiceIdFromProfile({ openness: 40, extraversion: 40, agreeableness: 70 }, null),
            'jf_alpha',
        );
    });

    it('storyteller wins when both thresholds match', () => {
        assert.equal(
            recommendVoiceIdFromProfile({ openness: 70, extraversion: 70, agreeableness: 80 }, null),
            'jf_tebukuro',
        );
    });

    it('detects gentle tone in aiAdvice approach', () => {
        assert.equal(
            recommendVoiceIdFromProfile(
                { openness: 50, extraversion: 50, agreeableness: 50 },
                { learningStrategy: { approach: 'A gentle step-by-step path' } },
            ),
            'jf_alpha',
        );
    });

    it('detects gentle tone in aiAdvice.tone field', () => {
        assert.equal(
            recommendVoiceIdFromProfile(
                { openness: 50, extraversion: 50, agreeableness: 50 },
                { tone: 'A calm and gentle guide' },
            ),
            'jf_alpha',
        );
    });
});
