const DEFAULT_VOICE_ID = 'jf_alpha';

/**
 * Deterministic voice recommendation from Big5 scores (spec §5).
 * @param {object | null | undefined} scores
 * @param {object | null | undefined} aiAdvice
 * @returns {string} voice_id
 */
export function recommendVoiceIdFromProfile(scores, aiAdvice) {
    if (!scores) return DEFAULT_VOICE_ID;

    const openness = scores.openness ?? 0;
    const extraversion = scores.extraversion ?? 0;
    const agreeableness = scores.agreeableness ?? 0;
    const approach = (aiAdvice?.learningStrategy?.approach || '').toLowerCase();
    const tone = (aiAdvice?.tone || '').toLowerCase();
    const gentleText = `${approach} ${tone}`;
    const gentle = gentleText.includes('gentle') || gentleText.includes('優し') || gentleText.includes('穏やか');

    const storyteller = openness >= 65 || extraversion >= 65;
    const lumina = agreeableness >= 65 || gentle;

    if (storyteller) return 'jf_tebukuro';
    if (lumina) return 'jf_alpha';
    return DEFAULT_VOICE_ID;
}
