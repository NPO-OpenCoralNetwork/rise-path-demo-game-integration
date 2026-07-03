import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import type { Language } from '../../../context/LanguageContext';
import { getVoicesForUi } from '../../../data/tts/voiceCatalog';
import {
    checkTtsAvailable,
    getDisplayName,
    isTtsUnavailableError,
    loadTtsPreferences,
    previewVoice,
    saveTtsPreferences,
    stopVoicePreview,
    type TtsPreferences,
} from '../../../services/ttsPreferencesService';
import VoiceOptionRow from './VoiceOptionRow';

interface VoiceQuickSwitchSheetProps {
    open: boolean;
    language: Language;
    onClose: () => void;
    onVoiceChange: (voiceId: string, displayName: string) => void;
    onOpenFullSettings: () => void;
}

const VoiceQuickSwitchSheet: React.FC<VoiceQuickSwitchSheetProps> = ({
    open,
    language,
    onClose,
    onVoiceChange,
    onOpenFullSettings,
}) => {
    const [prefs, setPrefs] = useState<TtsPreferences | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingVoiceId, setSavingVoiceId] = useState<string | null>(null);
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
    const [ttsUnavailable, setTtsUnavailable] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const copy = {
        en: {
            title: 'Narration voice',
            subtitle: 'Choose the voice for this lesson',
            fullSettings: 'All voice settings',
            saveFailed: 'Could not save your selection.',
            ttsUnavailable: 'Voice service is unavailable.',
            loading: 'Loading…',
        },
        jp: {
            title: 'ナレーションの声',
            subtitle: 'このレッスンの読み上げ声を選びます',
            fullSettings: '音声設定をすべて開く',
            saveFailed: '保存に失敗しました。',
            ttsUnavailable: '音声サービスに接続できません。',
            loading: '読み込み中…',
        },
    } as const;

    const t = copy[language];
    const voices = getVoicesForUi(language);

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
        if (!open) return;
        refresh();
        return () => stopVoicePreview();
    }, [open, refresh]);

    useEffect(() => {
        if (!open) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panelRef.current?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }
            if (event.key !== 'Tab' || !panelRef.current) return;

            const focusable = panelRef.current.querySelectorAll<HTMLElement>(
                'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, onClose]);

    const handleSelect = async (voiceId: string) => {
        if (ttsUnavailable || !prefs || prefs.voice_id === voiceId || savingVoiceId) return;
        setSavingVoiceId(voiceId);
        setSaveError(null);
        try {
            const saved = await saveTtsPreferences(
                { voice_id: voiceId, auto_recommend: false },
                language,
            );
            setPrefs(saved);
            onVoiceChange(voiceId, getDisplayName(voiceId, language));
        } catch {
            setSaveError(t.saveFailed);
        } finally {
            setSavingVoiceId(null);
        }
    };

    const handlePreview = async (voiceId: string) => {
        if (ttsUnavailable) return;
        setPreviewingId(voiceId);
        setPreviewErrors((prev) => ({ ...prev, [voiceId]: '' }));
        try {
            await previewVoice(voiceId, language);
        } catch (err) {
            if (isTtsUnavailableError(err)) {
                setTtsUnavailable(true);
                setPreviewErrors((prev) => ({ ...prev, [voiceId]: t.ttsUnavailable }));
            } else {
                const message = err instanceof Error ? err.message : 'Preview failed';
                setPreviewErrors((prev) => ({ ...prev, [voiceId]: message }));
            }
        } finally {
            setPreviewingId(null);
        }
    };

    if (!open) return null;

    const listDisabled = ttsUnavailable || savingVoiceId !== null;

    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="presentation">
            <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label={language === 'jp' ? '閉じる' : 'Close'}
                onClick={onClose}
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="voice-quick-switch-title"
                tabIndex={-1}
                className="relative bg-white rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col outline-none"
            >
                <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
                    <div className="space-y-1 min-w-0">
                        <h2 id="voice-quick-switch-title" className="text-lg font-bold text-slate-900">
                            {t.title}
                        </h2>
                        <p className="text-sm text-slate-500">{t.subtitle}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        aria-label={language === 'jp' ? '閉じる' : 'Close'}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="overflow-y-auto px-5 py-4 space-y-3">
                    {ttsUnavailable && (
                        <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-sm text-amber-800">
                            {t.ttsUnavailable}
                        </div>
                    )}
                    {saveError && (
                        <p className="text-sm text-red-600">{saveError}</p>
                    )}
                    {loading ? (
                        <p className="text-sm text-slate-400 text-center py-6">{t.loading}</p>
                    ) : (
                        <fieldset className="space-y-3 border-0 p-0 m-0 min-w-0">
                            <legend className="sr-only">{t.title}</legend>
                            {voices.map((entry) => (
                                <VoiceOptionRow
                                    key={entry.id}
                                    entry={entry}
                                    language={language}
                                    selected={prefs?.voice_id === entry.id}
                                    disabled={listDisabled}
                                    isPreviewing={previewingId === entry.id}
                                    previewError={previewErrors[entry.id] || null}
                                    onSelect={() => handleSelect(entry.id)}
                                    onPreview={() => handlePreview(entry.id)}
                                />
                            ))}
                        </fieldset>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-slate-100 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <button
                        type="button"
                        onClick={onOpenFullSettings}
                        className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 py-2.5"
                    >
                        <Settings2 size={16} />
                        {t.fullSettings}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VoiceQuickSwitchSheet;