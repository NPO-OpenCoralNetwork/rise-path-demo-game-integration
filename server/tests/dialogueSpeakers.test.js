import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DIALOGUE_SPEAKER_ROLES, resolveDialogueVoiceId } from '../../data/tts/dialogueSpeakersCore.js';

describe('resolveDialogueVoiceId', () => {
    it('returns default role mapping when prefs missing', () => {
        assert.equal(resolveDialogueVoiceId('Rise Path', null), 'jf_tebukuro');
        assert.equal(resolveDialogueVoiceId('Guest', null), 'jm_kumo');
    });

    it('uses speaker_voices override when provided', () => {
        assert.equal(
            resolveDialogueVoiceId('Guest', { speaker_voices: { Guest: 'jf_alpha' } }),
            'jf_alpha',
        );
    });

    it('falls back to narration voice_id for unknown speakers', () => {
        assert.equal(
            resolveDialogueVoiceId('Narrator', { voice_id: 'af_bella' }),
            'af_bella',
        );
    });

    it('aliases AI and Rise Path speaker voice overrides', () => {
        assert.equal(
            resolveDialogueVoiceId('AI', { speaker_voices: { 'Rise Path': 'jf_alpha' } }),
            'jf_alpha',
        );
        assert.equal(
            resolveDialogueVoiceId('Rise Path', { speaker_voices: { AI: 'jm_kumo' } }),
            'jm_kumo',
        );
    });

    it('defines canonical dialogue roles in core module', () => {
        assert.equal(DIALOGUE_SPEAKER_ROLES.length, 4);
        assert.deepEqual(
            DIALOGUE_SPEAKER_ROLES.map((role) => role.id).sort(),
            ['AI', 'Guest', 'Rise Path', 'User'].sort(),
        );
    });
});