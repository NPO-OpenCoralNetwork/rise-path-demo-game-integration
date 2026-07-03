import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isLocalTtsPreferencesNewer,
    mergeTtsPreferencesPatch,
    pickNewerTtsPreferences,
    shouldSaveTtsPreferencesLocally,
} from '../../services/ttsPreferencesMerge.js';

describe('pickNewerTtsPreferences', () => {
    it('prefers local when updated_at is newer', () => {
        const local = {
            voice_id: 'jf_tebukuro',
            updated_at: '2026-06-25T00:00:00.000Z',
        };
        const server = {
            voice_id: 'jf_alpha',
            updated_at: '2026-06-24T00:00:00.000Z',
        };
        assert.deepEqual(pickNewerTtsPreferences(local, server), local);
    });

    it('prefers server when updated_at is newer', () => {
        const local = {
            voice_id: 'jf_tebukuro',
            updated_at: '2026-06-23T00:00:00.000Z',
        };
        const server = {
            voice_id: 'jf_alpha',
            updated_at: '2026-06-24T00:00:00.000Z',
        };
        assert.deepEqual(pickNewerTtsPreferences(local, server), server);
    });

    it('returns whichever side has voice_id when the other is empty', () => {
        const server = { voice_id: 'jm_kumo' };
        assert.deepEqual(pickNewerTtsPreferences(null, server), server);
        assert.deepEqual(pickNewerTtsPreferences({ voice_id: 'jf_alpha' }, null), { voice_id: 'jf_alpha' });
    });
});

describe('isLocalTtsPreferencesNewer', () => {
    it('returns true only when local updated_at is strictly newer', () => {
        const local = { voice_id: 'jf_tebukuro', updated_at: '2026-06-25T00:00:00.000Z' };
        const server = { voice_id: 'jf_alpha', updated_at: '2026-06-24T00:00:00.000Z' };
        assert.equal(isLocalTtsPreferencesNewer(local, server), true);
        assert.equal(isLocalTtsPreferencesNewer(server, local), false);
        assert.equal(isLocalTtsPreferencesNewer(null, server), false);
    });
});

describe('mergeTtsPreferencesPatch', () => {
    it('shallow-merges speaker_voices across sequential patches', () => {
        const base = {
            voice_id: 'jf_alpha',
            speaker_voices: { Guest: 'jm_kumo', AI: 'jf_tebukuro' },
        };
        const first = mergeTtsPreferencesPatch(base, { speaker_voices: { Guest: 'jf_alpha' } });
        assert.deepEqual(first.speaker_voices, { Guest: 'jf_alpha', AI: 'jf_tebukuro' });

        const second = mergeTtsPreferencesPatch(first, { speaker_voices: { 'Rise Path': 'jf_tebukuro' } });
        assert.deepEqual(second.speaker_voices, {
            Guest: 'jf_alpha',
            AI: 'jf_tebukuro',
            'Rise Path': 'jf_tebukuro',
        });
    });
});

describe('shouldSaveTtsPreferencesLocally', () => {
    it('returns true for auth failures', () => {
        assert.equal(shouldSaveTtsPreferencesLocally(401), true);
        assert.equal(shouldSaveTtsPreferencesLocally(403), true);
    });

    it('returns false for other statuses', () => {
        assert.equal(shouldSaveTtsPreferencesLocally(500), false);
        assert.equal(shouldSaveTtsPreferencesLocally(200), false);
    });
});