import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    deepMergePreferences,
    extractTtsPreferences,
    getUserTtsPreferences,
    normalizeProfileRow,
    isSpeakerVoicesUpdateForbidden,
    validateTtsPreferencesPatch,
    wouldChangeSpeakerVoices,
} from '../services/userPreferences.js';
import { applyTtsRequestOptions, resolveVoiceId } from '../../tools/core/kokoroTts.js';

describe('validateTtsPreferencesPatch', () => {
    it('rejects invalid voice_id and speed', () => {
        const result = validateTtsPreferencesPatch({ voice_id: 'bad', speed: 3 });
        assert.ok(result);
        assert.match(result.error, /voice_id/);
        assert.match(result.error, /speed/);
    });

    it('accepts valid tts patch', () => {
        assert.equal(
            validateTtsPreferencesPatch({
                voice_id: 'jf_alpha',
                language: 'ja',
                lang_code: 'j',
                speed: 1.0,
                output_format: 'mp3',
                auto_recommend: true,
            }),
            null,
        );
    });

    it('accepts speaker_voices mapping', () => {
        assert.equal(
            validateTtsPreferencesPatch({
                speaker_voices: { 'Rise Path': 'jf_tebukuro', Guest: 'jm_kumo' },
            }),
            null,
        );
    });

    it('rejects invalid speaker_voices entries', () => {
        const result = validateTtsPreferencesPatch({
            speaker_voices: { Guest: 'not-a-voice' },
        });
        assert.ok(result);
        assert.match(result.error, /speaker_voices/);
    });
});

describe('deepMergePreferences', () => {
    it('deep-merges nested tts without clobbering sibling keys', () => {
        const merged = deepMergePreferences(
            { tts: { voice_id: 'jf_alpha', language: 'ja', speed: 1.0 }, theme: 'dark' },
            { tts: { voice_id: 'jf_tebukuro', updated_at: '2026-06-24T00:00:00.000Z' } },
        );

        assert.equal(merged.tts.voice_id, 'jf_tebukuro');
        assert.equal(merged.tts.language, 'ja');
        assert.equal(merged.tts.speed, 1.0);
        assert.equal(merged.tts.updated_at, '2026-06-24T00:00:00.000Z');
        assert.equal(merged.theme, 'dark');
    });

    it('returns empty object when existing is nullish', () => {
        assert.deepEqual(deepMergePreferences(null, { tts: { voice_id: 'jf_alpha' } }), {
            tts: { voice_id: 'jf_alpha' },
        });
    });

    it('deep-merges nested speaker_voices without clobbering siblings', () => {
        const merged = deepMergePreferences(
            { tts: { speaker_voices: { Guest: 'jm_kumo' }, voice_id: 'jf_alpha' } },
            { tts: { speaker_voices: { AI: 'jf_tebukuro' } } },
        );

        assert.deepEqual(merged.tts.speaker_voices, { Guest: 'jm_kumo', AI: 'jf_tebukuro' });
        assert.equal(merged.tts.voice_id, 'jf_alpha');
    });
});

describe('wouldChangeSpeakerVoices', () => {
    it('returns false when speaker_voices is omitted from patch', () => {
        assert.equal(
            wouldChangeSpeakerVoices(
                { tts: { speaker_voices: { Guest: 'jm_kumo' } } },
                { tts: { voice_id: 'jf_alpha' } },
            ),
            false,
        );
    });

    it('returns false when speaker_voices are unchanged', () => {
        assert.equal(
            wouldChangeSpeakerVoices(
                { tts: { speaker_voices: { Guest: 'jm_kumo', AI: 'jf_tebukuro' } } },
                { tts: { speaker_voices: { Guest: 'jm_kumo', AI: 'jf_tebukuro' }, voice_id: 'jf_alpha' } },
            ),
            false,
        );
    });

    it('returns true when speaker_voices change', () => {
        assert.equal(
            wouldChangeSpeakerVoices(
                { tts: { speaker_voices: { Guest: 'jm_kumo' } } },
                { tts: { speaker_voices: { Guest: 'jf_alpha' } } },
            ),
            true,
        );
    });

    it('returns true when speaker_voices are added for the first time', () => {
        assert.equal(
            wouldChangeSpeakerVoices(
                { tts: { voice_id: 'jf_alpha' } },
                { tts: { speaker_voices: { AI: 'jf_tebukuro' } } },
            ),
            true,
        );
    });
});

describe('isSpeakerVoicesUpdateForbidden', () => {
    const existing = { tts: { speaker_voices: { Guest: 'jm_kumo' }, voice_id: 'jf_alpha' } };
    const unchangedPatch = {
        tts: { speaker_voices: { Guest: 'jm_kumo' }, voice_id: 'jf_tebukuro' },
    };
    const changedPatch = {
        tts: { speaker_voices: { Guest: 'jf_alpha' } },
    };

    it('allows learners when speaker_voices are unchanged', () => {
        assert.equal(isSpeakerVoicesUpdateForbidden('learner', existing, unchangedPatch), false);
    });

    it('forbids learners when speaker_voices change', () => {
        assert.equal(isSpeakerVoicesUpdateForbidden('learner', existing, changedPatch), true);
    });

    it('allows admins when speaker_voices change', () => {
        assert.equal(isSpeakerVoicesUpdateForbidden('admin', existing, changedPatch), false);
    });

    it('allows any role when preferences patch omits speaker_voices changes', () => {
        assert.equal(
            isSpeakerVoicesUpdateForbidden('learner', existing, { tts: { voice_id: 'jf_tebukuro' } }),
            false,
        );
    });
});

describe('normalizeProfileRow', () => {
    it('defaults preferences to {}', () => {
        const profile = normalizeProfileRow({ display_name: 'Alex' });
        assert.deepEqual(profile.preferences, {});
        assert.equal(profile.display_name, 'Alex');
    });
});

describe('extractTtsPreferences / getUserTtsPreferences', () => {
    it('extractTtsPreferences returns null for invalid shapes', () => {
        assert.equal(extractTtsPreferences(null), null);
        assert.equal(extractTtsPreferences({}), null);
        assert.equal(extractTtsPreferences({ tts: 'bad' }), null);
    });

    it('getUserTtsPreferences reads nested tts from DB row', async () => {
        const pool = {
            query: async () => ({
                rowCount: 1,
                rows: [{ preferences: { tts: { voice_id: 'jm_kumo', lang_code: 'j' } } }],
            }),
        };

        const tts = await getUserTtsPreferences(pool, 'user-1');
        assert.deepEqual(tts, { voice_id: 'jm_kumo', lang_code: 'j' });
    });

    it('getUserTtsPreferences returns null when profile missing', async () => {
        const pool = {
            query: async () => ({ rowCount: 0, rows: [] }),
        };
        assert.equal(await getUserTtsPreferences(pool, 'missing'), null);
    });

    it('feeds requestTts merge path: DB prefs resolve to voice_id', () => {
        const prefs = { voice_id: 'jm_kumo', lang_code: 'j', language: 'ja' };
        const opts = applyTtsRequestOptions({ text: 'preview', language: 'ja' }, prefs);
        assert.equal(opts.voice_id, 'jm_kumo');
        assert.equal(resolveVoiceId(opts), 'jm_kumo');
    });
});

describe('applyTtsRequestOptions', () => {
    it('prefers explicit voice_id over saved preferences', () => {
        const opts = applyTtsRequestOptions(
            { text: 'hello', voice_id: 'jf_tebukuro' },
            { voice_id: 'jf_alpha', language: 'ja', lang_code: 'j', speed: 0.9 },
        );
        assert.equal(opts.voice_id, 'jf_tebukuro');
        assert.equal(opts.language, 'ja');
        assert.equal(opts.lang_code, 'j');
        assert.equal(opts.speed, 0.9);
    });

    it('falls back to saved preferences when explicit args omitted', () => {
        const opts = applyTtsRequestOptions(
            { text: 'hello' },
            { voice_id: 'jm_kumo', language: 'ja', lang_code: 'j', output_format: 'wav' },
        );
        assert.equal(opts.voice_id, 'jm_kumo');
        assert.equal(opts.output_format, 'wav');
    });

    it('uses env defaults path when no prefs and no voice_id', () => {
        const opts = applyTtsRequestOptions({ text: 'hello', language: 'ja' }, null);
        assert.equal(opts.language, 'ja');
        assert.equal(opts.voice_id, undefined);
        assert.equal(opts.output_format, 'mp3');
    });
});