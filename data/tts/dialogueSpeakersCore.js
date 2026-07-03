const DEFAULT_VOICE_ID = 'jf_alpha';

/** @type {{ id: string, defaultVoiceId: string }[]} */
export const DIALOGUE_SPEAKER_ROLES = [
    { id: 'Rise Path', defaultVoiceId: 'jf_tebukuro' },
    { id: 'AI', defaultVoiceId: 'jf_tebukuro' },
    { id: 'Guest', defaultVoiceId: 'jm_kumo' },
    { id: 'User', defaultVoiceId: 'jm_kumo' },
];

const SPEAKER_VOICE_ALIASES = {
    AI: ['Rise Path'],
    'Rise Path': ['AI'],
};

/**
 * @param {string} speaker
 * @param {Record<string, string> | undefined} speakerVoices
 * @returns {string | undefined}
 */
function resolveSpeakerVoiceOverride(speaker, speakerVoices) {
    if (!speakerVoices) return undefined;
    if (speakerVoices[speaker]) return speakerVoices[speaker];
    for (const alias of SPEAKER_VOICE_ALIASES[speaker] ?? []) {
        if (speakerVoices[alias]) return speakerVoices[alias];
    }
    return undefined;
}

/**
 * @param {string} speaker
 * @param {{ speaker_voices?: Record<string, string>, voice_id?: string } | null | undefined} prefs
 * @returns {string}
 */
export function resolveDialogueVoiceId(speaker, prefs) {
    const override = resolveSpeakerVoiceOverride(speaker, prefs?.speaker_voices);
    if (override) return override;

    const role = DIALOGUE_SPEAKER_ROLES.find((entry) => entry.id === speaker);
    if (role) return role.defaultVoiceId;

    return prefs?.voice_id ?? DEFAULT_VOICE_ID;
}