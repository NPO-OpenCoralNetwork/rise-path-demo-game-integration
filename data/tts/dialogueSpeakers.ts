import { DEFAULT_VOICE_ID } from './voiceCatalog';
import type { TtsPreferences } from '../../services/ttsPreferencesService';

export type DialogueSpeakerRole = {
    id: string;
    label: { jp: string; en: string };
    defaultVoiceId: string;
};

/** Known dialogue roles aligned with TTS spec §dialogue_audio and curriculum parsers. */
export const DIALOGUE_SPEAKER_ROLES: DialogueSpeakerRole[] = [
    {
        id: 'Rise Path',
        label: { jp: 'Rise Path', en: 'Rise Path' },
        defaultVoiceId: 'jf_tebukuro',
    },
    {
        id: 'AI',
        label: { jp: 'AI（ナレーター）', en: 'AI (Narrator)' },
        defaultVoiceId: 'jf_tebukuro',
    },
    {
        id: 'Guest',
        label: { jp: 'ゲスト', en: 'Guest' },
        defaultVoiceId: 'jm_kumo',
    },
    {
        id: 'User',
        label: { jp: 'ユーザー', en: 'User' },
        defaultVoiceId: 'jm_kumo',
    },
];

export function getDefaultSpeakerVoices(): Record<string, string> {
    return Object.fromEntries(
        DIALOGUE_SPEAKER_ROLES.map((role) => [role.id, role.defaultVoiceId]),
    );
}

const SPEAKER_VOICE_ALIASES: Record<string, string[]> = {
    AI: ['Rise Path'],
    'Rise Path': ['AI'],
};

function resolveSpeakerVoiceOverride(
    speaker: string,
    speakerVoices?: Record<string, string>,
): string | undefined {
    if (!speakerVoices) return undefined;
    if (speakerVoices[speaker]) return speakerVoices[speaker];
    for (const alias of SPEAKER_VOICE_ALIASES[speaker] ?? []) {
        if (speakerVoices[alias]) return speakerVoices[alias];
    }
    return undefined;
}

export function resolveDialogueVoiceId(
    speaker: string,
    prefs?: Pick<TtsPreferences, 'speaker_voices' | 'voice_id'> | null,
): string {
    const override = resolveSpeakerVoiceOverride(speaker, prefs?.speaker_voices);
    if (override) return override;

    const role = DIALOGUE_SPEAKER_ROLES.find((entry) => entry.id === speaker);
    if (role) return role.defaultVoiceId;

    return prefs?.voice_id ?? DEFAULT_VOICE_ID;
}