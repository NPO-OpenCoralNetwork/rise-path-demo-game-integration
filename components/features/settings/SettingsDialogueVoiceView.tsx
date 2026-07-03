import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import { useUserRole } from '../../../hooks/useUserRole';
import { DIALOGUE_SPEAKER_ROLES, resolveDialogueVoiceId } from '../../../data/tts/dialogueSpeakers';
import { getVoiceById, getVoicesForUi } from '../../../data/tts/voiceCatalog';
import {
    checkTtsAvailable,
    loadTtsPreferences,
    saveTtsPreferences,
    type TtsPreferences,
} from '../../../services/ttsPreferencesService';

interface SettingsDialogueVoiceViewProps {
    onNavigate: (view: ViewState) => void;
}

const SettingsDialogueVoiceView: React.FC<SettingsDialogueVoiceViewProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { setTheme } = useTheme();
    const { isAdmin, loading: roleLoading } = useUserRole();
    const [prefs, setPrefs] = useState<TtsPreferences | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingSpeaker, setSavingSpeaker] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [ttsUnavailable, setTtsUnavailable] = useState(false);

    useEffect(() => { setTheme('default'); }, [setTheme]);

    useEffect(() => {
        if (!roleLoading && !isAdmin) {
            onNavigate(ViewState.SETTINGS_VOICE);
        }
    }, [roleLoading, isAdmin, onNavigate]);

    const copy = {
        en: {
            back: 'Voice & Narration',
            title: 'Dialogue voices',
            subtitle: 'Assign a narrator voice to each dialogue role.',
            saved: 'Saved',
            saveFailed: 'Could not save mapping.',
            loading: 'Loading…',
            ttsUnavailable: 'Voice service is unavailable.',
            defaultHint: 'Default',
        },
        jp: {
            back: '音声とナレーション',
            title: '対話の話者マッピング',
            subtitle: '対話ブロックの各役にナレーション声を割り当てます。',
            saved: '保存しました',
            saveFailed: '保存に失敗しました。',
            loading: '読み込み中…',
            ttsUnavailable: '音声サービスに接続できません。',
            defaultHint: '既定',
        },
    } as const;

    const t = copy[language];
    // Dialogue Kokoro lines use Japanese lang_code in MVP (spec §dialogue_audio).
    const voices = getVoicesForUi(language).filter((entry) => entry.languages.includes('ja'));

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [loaded, available] = await Promise.all([
                loadTtsPreferences(language),
                checkTtsAvailable(),
            ]);
            setPrefs(loaded);
            setTtsUnavailable(!available);
        } finally {
            setLoading(false);
        }
    }, [language]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleSpeakerChange = async (speakerId: string, voiceId: string) => {
        if (ttsUnavailable || !prefs || savingSpeaker) return;
        if (resolveDialogueVoiceId(speakerId, prefs) === voiceId) return;

        setSavingSpeaker(speakerId);
        setSaveError(null);
        try {
            const savedPrefs = await saveTtsPreferences(
                { speaker_voices: { [speakerId]: voiceId } },
                language,
            );
            setPrefs(savedPrefs);
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
        } catch {
            setSaveError(t.saveFailed);
        } finally {
            setSavingSpeaker(null);
        }
    };

    if (roleLoading || !isAdmin) {
        return (
            <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
                <p className="text-sm text-slate-400 text-center py-8">{t.loading}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
            <div className="max-w-2xl mx-auto space-y-8">
                <button
                    type="button"
                    onClick={() => onNavigate(ViewState.SETTINGS_VOICE)}
                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                >
                    <ArrowLeft size={16} /> {t.back}
                </button>

                <header className="space-y-2">
                    <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
                    <p className="text-slate-500">{t.subtitle}</p>
                    {saved && (
                        <p className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                            <Check size={16} /> {t.saved}
                        </p>
                    )}
                    {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                </header>

                {ttsUnavailable && (
                    <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-sm text-amber-800">
                        {t.ttsUnavailable}
                    </div>
                )}

                {loading ? (
                    <p className="text-sm text-slate-400 text-center py-8">{t.loading}</p>
                ) : (
                    <div className="space-y-4">
                        {DIALOGUE_SPEAKER_ROLES.map((role) => {
                            const selectedVoice = resolveDialogueVoiceId(role.id, prefs);
                            return (
                                <div
                                    key={role.id}
                                    className="bg-white border border-slate-100 rounded-2xl px-4 py-4 space-y-3"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="font-medium text-slate-800">{role.label[language]}</p>
                                            <p className="text-xs text-slate-500">
                                                {t.defaultHint}: {getVoiceById(role.defaultVoiceId)?.label[language] ?? role.defaultVoiceId}
                                            </p>
                                        </div>
                                    </div>
                                    <select
                                        value={selectedVoice}
                                        disabled={ttsUnavailable || savingSpeaker === role.id}
                                        onChange={(e) => handleSpeakerChange(role.id, e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                                        aria-label={role.label[language]}
                                    >
                                        {voices.map((entry) => (
                                            <option key={entry.id} value={entry.id}>
                                                {entry.label[language]}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsDialogueVoiceView;