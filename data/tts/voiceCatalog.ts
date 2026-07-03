import type { Language } from '../../context/LanguageContext';

export type VoiceCatalogEntry = {
    id: string;
    langCode: 'j' | 'a';
    label: { jp: string; en: string };
    description: { jp: string; en: string };
    previewText: { jp: string; en: string };
    languages: ('ja' | 'en')[];
};

export const VOICE_CATALOG: VoiceCatalogEntry[] = [
    {
        id: 'jf_alpha',
        langCode: 'j',
        label: { jp: 'ルミナ', en: 'Lumina' },
        description: { jp: '落ち着いたガイド', en: 'Calm guide' },
        previewText: {
            jp: 'こんにちは。ルミナです。一緒に学びましょう。',
            en: "Hello. I'm Lumina. Let's learn together.",
        },
        languages: ['ja', 'en'],
    },
    {
        id: 'jf_tebukuro',
        langCode: 'j',
        label: { jp: '物語の声', en: 'Storyteller' },
        description: { jp: '対話・ストーリー向け', en: 'Dialogue & stories' },
        previewText: {
            jp: '物語の声です。対話形式で進めましょう。',
            en: "I'm the storyteller voice. Let's explore together.",
        },
        languages: ['ja', 'en'],
    },
    {
        id: 'jm_kumo',
        langCode: 'j',
        label: { jp: 'ゲスト', en: 'Guest' },
        description: { jp: '会話の相手役', en: 'Conversation partner' },
        previewText: {
            jp: 'ゲストの声です。一緒に考えていきましょう。',
            en: "I'm the guest voice. Let's think this through.",
        },
        languages: ['ja', 'en'],
    },
    {
        id: 'af_bella',
        langCode: 'a',
        label: { jp: 'ベラ', en: 'Bella' },
        description: { jp: '明るくクリアなナレーション', en: 'Bright, clear narration' },
        previewText: {
            jp: 'Hello. I am Bella. Let us begin the lesson.',
            en: "Hello. I'm Bella. Let's begin the lesson.",
        },
        languages: ['en'],
    },
    {
        id: 'af_heart',
        langCode: 'a',
        label: { jp: 'ハート', en: 'Heart' },
        description: { jp: '温かみのある読み上げ', en: 'Warm, expressive tone' },
        previewText: {
            jp: 'Hello. I am Heart. I will guide you through this topic.',
            en: "Hello. I'm Heart. I'll guide you through this topic.",
        },
        languages: ['en'],
    },
];

export const DEFAULT_VOICE_ID = 'jf_alpha';

export function getVoiceById(voiceId: string): VoiceCatalogEntry | undefined {
    return VOICE_CATALOG.find((entry) => entry.id === voiceId);
}

export function getVoiceLabel(voiceId: string, language: Language): string {
    const entry = getVoiceById(voiceId);
    if (!entry) return language === 'jp' ? 'AI音声' : 'AI Voice';
    return entry.label[language];
}

export function getVoicesForUi(language: Language): VoiceCatalogEntry[] {
    return VOICE_CATALOG.filter((entry) => entry.languages.includes(language === 'jp' ? 'ja' : 'en'));
}

export function getPreviewText(voiceId: string, language: Language): string {
    const entry = getVoiceById(voiceId);
    if (!entry) return '';
    return entry.previewText[language];
}

/** Preview synthesis params aligned with voice lang_code (spec §4.2.2 / 17-B). */
export function getPreviewSynthesisParams(entry: VoiceCatalogEntry): {
    text: string;
    language: 'ja' | 'en';
    lang_code: string;
} {
    if (entry.langCode === 'a') {
        return {
            text: entry.previewText.en,
            language: 'en',
            lang_code: 'a',
        };
    }
    return {
        text: entry.previewText.jp,
        language: 'ja',
        lang_code: entry.langCode,
    };
}