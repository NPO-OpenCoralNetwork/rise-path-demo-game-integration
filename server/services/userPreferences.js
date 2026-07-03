/**
 * user_profiles.preferences helpers (Phase 17-0).
 */

import { VOICE_ID_PATTERN } from '../../tools/core/kokoroTts.js';

export function validatePrivacyPreferencesPatch(privacy) {
    if (privacy === undefined) return null;
    if (privacy === null || typeof privacy !== 'object' || Array.isArray(privacy)) {
        return { error: 'preferences.privacy must be an object', fields: ['preferences.privacy'] };
    }

    const errors = [];

    const lifeJournal = privacy.life_journal;
    if (lifeJournal !== undefined) {
        if (lifeJournal === null || typeof lifeJournal !== 'object' || Array.isArray(lifeJournal)) {
            return { error: 'preferences.privacy.life_journal must be an object', fields: ['preferences.privacy.life_journal'] };
        }
        if (lifeJournal.allow_diary_excerpts_in_ai != null
            && typeof lifeJournal.allow_diary_excerpts_in_ai !== 'boolean') {
            errors.push('preferences.privacy.life_journal.allow_diary_excerpts_in_ai must be a boolean');
        }
    }

    const aiMemory = privacy.ai_memory;
    if (aiMemory !== undefined) {
        if (aiMemory === null || typeof aiMemory !== 'object' || Array.isArray(aiMemory)) {
            return { error: 'preferences.privacy.ai_memory must be an object', fields: ['preferences.privacy.ai_memory'] };
        }
        if (aiMemory.enabled != null && typeof aiMemory.enabled !== 'boolean') {
            errors.push('preferences.privacy.ai_memory.enabled must be a boolean');
        }
        if (aiMemory.allow_conversation_capture != null
            && typeof aiMemory.allow_conversation_capture !== 'boolean') {
            errors.push('preferences.privacy.ai_memory.allow_conversation_capture must be a boolean');
        }
    }

    if (errors.length === 0) return null;
    return { error: errors.join('; '), fields: errors };
}

export function validateTtsPreferencesPatch(tts) {
    if (tts === undefined) return null;
    if (tts === null || typeof tts !== 'object' || Array.isArray(tts)) {
        return { error: 'preferences.tts must be an object', fields: ['preferences.tts'] };
    }

    const errors = [];
    if (tts.voice_id != null && (typeof tts.voice_id !== 'string' || !VOICE_ID_PATTERN.test(tts.voice_id))) {
        errors.push('preferences.tts.voice_id is invalid');
    }
    if (tts.language != null && tts.language !== 'ja' && tts.language !== 'en') {
        errors.push('preferences.tts.language must be ja or en');
    }
    if (tts.lang_code != null && (typeof tts.lang_code !== 'string' || !/^[jabzefhip]$/.test(tts.lang_code))) {
        errors.push('preferences.tts.lang_code is invalid');
    }
    if (tts.speed != null && (typeof tts.speed !== 'number' || !Number.isFinite(tts.speed) || tts.speed < 0.5 || tts.speed > 2.0)) {
        errors.push('preferences.tts.speed must be between 0.5 and 2.0');
    }
    if (tts.output_format != null && tts.output_format !== 'mp3' && tts.output_format !== 'wav') {
        errors.push('preferences.tts.output_format must be mp3 or wav');
    }
    if (tts.auto_recommend != null && typeof tts.auto_recommend !== 'boolean') {
        errors.push('preferences.tts.auto_recommend must be a boolean');
    }
    if (tts.speaker_voices != null) {
        if (typeof tts.speaker_voices !== 'object' || Array.isArray(tts.speaker_voices)) {
            errors.push('preferences.tts.speaker_voices must be an object');
        } else {
            for (const [speaker, voiceId] of Object.entries(tts.speaker_voices)) {
                if (typeof voiceId !== 'string' || !VOICE_ID_PATTERN.test(voiceId)) {
                    errors.push(`preferences.tts.speaker_voices.${speaker} is invalid`);
                }
            }
        }
    }

    if (errors.length === 0) return null;
    return { error: errors.join('; '), fields: errors };
}

function normalizeSpeakerVoices(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value;
}

/** True when a preferences patch would change stored speaker_voices. */
export function wouldChangeSpeakerVoices(existingPreferences, preferencesPatch) {
    const patchSpeakerVoices = preferencesPatch?.tts?.speaker_voices;
    if (patchSpeakerVoices === undefined) {
        return false;
    }

    const current = normalizeSpeakerVoices(existingPreferences?.tts?.speaker_voices);
    const merged = deepMergePreferences(
        { speaker_voices: current },
        { speaker_voices: patchSpeakerVoices },
    ).speaker_voices;

    return JSON.stringify(current) !== JSON.stringify(merged);
}

/** Mirrors PUT /user/profile authorization for dialogue speaker mapping updates. */
export function isSpeakerVoicesUpdateForbidden(userRole, existingPreferences, preferencesPatch) {
    if (preferencesPatch === undefined) return false;
    if (!wouldChangeSpeakerVoices(existingPreferences, preferencesPatch)) return false;
    return userRole !== 'admin';
}

export function deepMergePreferences(existing, incoming) {
    const base = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...existing }
        : {};

    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return base;
    }

    for (const [key, value] of Object.entries(incoming)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            base[key] = deepMergePreferences(base[key], value);
        } else if (value !== undefined) {
            base[key] = value;
        }
    }

    return base;
}

export function normalizeProfileRow(row = {}) {
    const preferences = row.preferences && typeof row.preferences === 'object' && !Array.isArray(row.preferences)
        ? row.preferences
        : {};

    return {
        display_name: row.display_name ?? 'Learner',
        avatar_url: row.avatar_url ?? '',
        role: row.role ?? 'learner',
        created_at: row.created_at ?? null,
        preferences,
    };
}

export function extractTtsPreferences(preferences) {
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
        return null;
    }
    const tts = preferences.tts;
    if (!tts || typeof tts !== 'object' || Array.isArray(tts)) {
        return null;
    }
    return tts;
}

export async function getUserTtsPreferences(pool, userId) {
    if (!pool || !userId) return null;

    const result = await pool.query(
        'SELECT preferences FROM user_profiles WHERE user_id = $1',
        [userId],
    );

    if (result.rowCount === 0) return null;
    return extractTtsPreferences(result.rows[0].preferences);
}