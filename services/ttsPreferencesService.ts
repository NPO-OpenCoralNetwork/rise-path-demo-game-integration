import type { Language } from '../context/LanguageContext';
import {
    DEFAULT_VOICE_ID,
    getPreviewSynthesisParams,
    getVoiceById,
    getVoiceLabel,
    type VoiceCatalogEntry,
} from '../data/tts/voiceCatalog';
import { apiFetch, apiGet, isApiAvailable } from './apiClient';
import { clearUserProfileCache } from './userProfileService';
import {
    isLocalTtsPreferencesNewer,
    mergeTtsPreferencesPatch,
    pickNewerTtsPreferences,
    shouldSaveTtsPreferencesLocally,
} from './ttsPreferencesMerge.js';

export { mergeTtsPreferencesPatch, pickNewerTtsPreferences } from './ttsPreferencesMerge.js';

export const TTS_PREFERENCES_CHANGED_EVENT = 'rise-path:tts-preferences-changed';

export function notifyTtsPreferencesChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(TTS_PREFERENCES_CHANGED_EVENT));
}

export type TtsPreferences = {
    voice_id: string;
    language: 'ja' | 'en';
    lang_code: string;
    speed?: number;
    output_format?: 'mp3' | 'wav';
    auto_recommend?: boolean;
    speaker_voices?: Record<string, string>;
    updated_at?: string;
};

const STORAGE_KEY = 'rp_tts_preferences';
const TTS_AVAIL_TTL_MS = 30_000;

let ttsAvailableCache: { value: boolean; at: number } | null = null;

export class TtsUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TtsUnavailableError';
    }
}

export function isTtsUnavailableError(err: unknown): boolean {
    return err instanceof TtsUnavailableError
        || (err instanceof Error && err.name === 'TtsUnavailableError');
}

export function invalidateTtsAvailableCache(): void {
    ttsAvailableCache = null;
}

function setTtsAvailableCache(value: boolean): void {
    ttsAvailableCache = { value, at: Date.now() };
}

export function uiLanguageToTts(language: Language): 'ja' | 'en' {
    return language === 'jp' ? 'ja' : 'en';
}

export function buildTtsPreferences(
    voiceId: string,
    uiLanguage: Language,
    overrides: Partial<TtsPreferences> = {},
): TtsPreferences {
    const entry = getVoiceById(voiceId) ?? getVoiceById(DEFAULT_VOICE_ID)!;
    return {
        voice_id: entry.id,
        language: uiLanguageToTts(uiLanguage),
        lang_code: entry.langCode,
        speed: 1.0,
        output_format: 'mp3',
        auto_recommend: true,
        ...overrides,
    };
}

export function getDefaultTtsPreferences(uiLanguage: Language): TtsPreferences {
    return buildTtsPreferences(DEFAULT_VOICE_ID, uiLanguage);
}

export function loadLocalTtsPreferences(): TtsPreferences | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.voice_id) return null;
        return parsed as TtsPreferences;
    } catch {
        return null;
    }
}

export function saveLocalTtsPreferences(prefs: TtsPreferences): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function mergeTtsPreferences(
    base: TtsPreferences,
    incoming?: Partial<TtsPreferences> | null,
): TtsPreferences {
    if (!incoming) return base;
    return mergeTtsPreferencesPatch(base, incoming) as TtsPreferences;
}

async function seedTtsPreferencesToServer(prefs: TtsPreferences): Promise<void> {
    if (!isApiAvailable()) return;

    try {
        const res = await apiFetch('/user/profile', {
            method: 'PUT',
            body: JSON.stringify({ preferences: { tts: prefs } }),
        });
        if (shouldSaveTtsPreferencesLocally(res.status) || !res.ok) return;

        const data = await res.json() as {
            profile?: { preferences?: { tts?: TtsPreferences } };
        };
        clearUserProfileCache();
        if (data.profile?.preferences?.tts) {
            const saved = mergeTtsPreferences(prefs, data.profile.preferences.tts);
            saveLocalTtsPreferences(saved);
        }
    } catch {
        // Background seed — ignore failures
    }
}

export async function loadTtsPreferences(uiLanguage: Language): Promise<TtsPreferences> {
    const local = loadLocalTtsPreferences();
    const fallback = local ?? getDefaultTtsPreferences(uiLanguage);

    if (!isApiAvailable()) {
        return mergeTtsPreferences(fallback, { language: uiLanguageToTts(uiLanguage) });
    }

    try {
        const res = await apiGet<{ ok: boolean; profile?: { preferences?: { tts?: TtsPreferences } } }>(
            '/user/profile',
        );
        const serverTts = res.profile?.preferences?.tts;
        if (serverTts?.voice_id) {
            const serverMerged = mergeTtsPreferences(fallback, serverTts);
            const winner = pickNewerTtsPreferences(local, serverMerged) ?? serverMerged;
            saveLocalTtsPreferences(winner);
            if (isLocalTtsPreferencesNewer(local, serverMerged)) {
                void seedTtsPreferencesToServer(winner);
            }
            return winner;
        }

        const merged = mergeTtsPreferences(fallback, { language: uiLanguageToTts(uiLanguage) });
        if (local?.voice_id) {
            void seedTtsPreferencesToServer(merged);
        }
        return merged;
    } catch {
        // API unavailable — use local fallback
    }

    return mergeTtsPreferences(fallback, { language: uiLanguageToTts(uiLanguage) });
}

export async function saveTtsPreferences(
    patch: Partial<TtsPreferences>,
    uiLanguage: Language,
): Promise<TtsPreferences> {
    const current = await loadTtsPreferences(uiLanguage);
    const previous = { ...current };
    const entry = getVoiceById(patch.voice_id ?? current.voice_id);
    const next = mergeTtsPreferencesPatch(current, {
        ...patch,
        voice_id: patch.voice_id ?? current.voice_id,
        language: uiLanguageToTts(uiLanguage),
        lang_code: entry?.langCode ?? current.lang_code,
        updated_at: new Date().toISOString(),
        auto_recommend: patch.auto_recommend ?? (patch.voice_id ? false : current.auto_recommend),
    }) as TtsPreferences;

    if (isApiAvailable()) {
        try {
            const res = await apiFetch('/user/profile', {
                method: 'PUT',
                body: JSON.stringify({ preferences: { tts: next } }),
            });

            if (shouldSaveTtsPreferencesLocally(res.status)) {
                saveLocalTtsPreferences(next);
                notifyTtsPreferencesChanged();
                return next;
            }

            if (!res.ok) {
                saveLocalTtsPreferences(previous);
                throw new Error('Failed to save TTS preferences');
            }

            clearUserProfileCache();
            const data = await res.json() as {
                ok: boolean;
                profile?: { preferences?: { tts?: TtsPreferences } };
            };
            if (data.profile?.preferences?.tts) {
                const saved = mergeTtsPreferences(next, data.profile.preferences.tts);
                saveLocalTtsPreferences(saved);
                notifyTtsPreferencesChanged();
                return saved;
            }
            saveLocalTtsPreferences(next);
            notifyTtsPreferencesChanged();
            return next;
        } catch (err) {
            if (err instanceof Error && err.message === 'Failed to save TTS preferences') {
                throw err;
            }
            saveLocalTtsPreferences(previous);
            throw new Error('Failed to save TTS preferences');
        }
    }

    saveLocalTtsPreferences(next);
    notifyTtsPreferencesChanged();
    return next;
}

export function getDisplayName(voiceId: string, uiLanguage: Language): string {
    return getVoiceLabel(voiceId, uiLanguage);
}

export async function checkTtsAvailable(): Promise<boolean> {
    if (ttsAvailableCache && Date.now() - ttsAvailableCache.at < TTS_AVAIL_TTL_MS) {
        return ttsAvailableCache.value;
    }

    try {
        const res = await apiFetch('/tts/health');
        const available = res.ok;
        setTtsAvailableCache(available);
        return available;
    } catch {
        setTtsAvailableCache(false);
        return false;
    }
}

let previewAudio: HTMLAudioElement | null = null;

export function stopVoicePreview(): void {
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
    }
}

export async function previewVoice(voiceId: string, uiLanguage: Language): Promise<void> {
    const entry = getVoiceById(voiceId);
    if (!entry) throw new Error('Unknown voice');

    stopVoicePreview();

    const { text, language, lang_code } = getPreviewSynthesisParams(entry);
    const res = await apiFetch('/tts/synthesize', {
        method: 'POST',
        body: JSON.stringify({
            text,
            voice_id: voiceId,
            language,
            lang_code,
            output_format: 'mp3',
        }),
    });

    if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (res.status === 503 || payload.error_type === 'tts_unavailable') {
            invalidateTtsAvailableCache();
            throw new TtsUnavailableError(payload.error || 'Voice service is unavailable');
        }
        throw new Error(payload.error || `TTS preview failed (${res.status})`);
    }

    const payload = await res.json();
    if (!payload.audio_url) {
        throw new Error('TTS response missing audio_url');
    }

    previewAudio = new Audio(payload.audio_url);
    try {
        await previewAudio.play();
    } catch {
        const message = uiLanguage === 'jp'
            ? 'もう一度タップして再生してください'
            : 'Tap again to play';
        throw new Error(message);
    }
}

export type { VoiceCatalogEntry };