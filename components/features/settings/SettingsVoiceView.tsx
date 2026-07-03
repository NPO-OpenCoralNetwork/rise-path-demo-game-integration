import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import {
    ASSESSMENT_PROFILE_CHANGED_EVENT,
    ASSESSMENT_PROFILE_STORAGE_KEY,
} from '../../../constants/assessment';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import { recommendVoiceId } from '../../../data/tts/voiceRecommendations';
import { getVoicesForUi } from '../../../data/tts/voiceCatalog';
import {
    checkTtsAvailable,
    isTtsUnavailableError,
    loadTtsPreferences,
    previewVoice,
    saveTtsPreferences,
    stopVoicePreview,
    type TtsPreferences,
} from '../../../services/ttsPreferencesService';
import { useUserRole } from '../../../hooks/useUserRole';
import VoiceAdvancedPanel from './VoiceAdvancedPanel';
import VoiceOptionRow from './VoiceOptionRow';
import VoiceRecommendBanner from './VoiceRecommendBanner';

interface SettingsVoiceViewProps {
    onNavigate: (view: ViewState) => void;
}

type PersistJob = {
    patch: Partial<TtsPreferences>;
    options: { optimistic?: Partial<TtsPreferences>; voiceId?: string };
    resolve: (value: TtsPreferences | null) => void;
};

const SettingsVoiceView: React.FC<SettingsVoiceViewProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { setTheme } = useTheme();
    const { isAdmin } = useUserRole();
    const [prefs, setPrefs] = useState<TtsPreferences | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingVoiceId, setSavingVoiceId] = useState<string | null>(null);
    const [savingAdvanced, setSavingAdvanced] = useState(false);
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
    const [ttsUnavailable, setTtsUnavailable] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistInFlightRef = useRef(false);
    const persistQueueRef = useRef<PersistJob[]>([]);
    const prefsRef = useRef<TtsPreferences | null>(null);
    const ttsUnavailableRef = useRef(ttsUnavailable);
    const mountedRef = useRef(true);
    const hasSyncedOnLoadRef = useRef(false);
    const lastVisibilitySyncRef = useRef(0);
    const runPersistQueueRef = useRef<() => void>(() => {});

    useEffect(() => { setTheme('default'); }, [setTheme]);

    useEffect(() => {
        prefsRef.current = prefs;
        if (prefs && persistQueueRef.current.length > 0) {
            void runPersistQueueRef.current();
        }
    }, [prefs]);

    useEffect(() => {
        ttsUnavailableRef.current = ttsUnavailable;
    }, [ttsUnavailable]);

    useEffect(() => () => {
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            while (persistQueueRef.current.length > 0) {
                const job = persistQueueRef.current.shift();
                job?.resolve(null);
            }
        };
    }, []);

    const copy = {
        en: {
            back: 'Settings',
            title: 'Voice & Narration',
            subtitle: 'Choose the voice for lesson narration',
            saved: 'Saved',
            ttsUnavailable: 'Voice service is unavailable. Try again later.',
            saveFailed: 'Could not save your selection.',
            loading: 'Loading voices…',
            dialogueVoices: 'Dialogue speaker mapping',
            dialogueVoicesHint: 'Assign voices per dialogue role',
        },
        jp: {
            back: '設定',
            title: '音声とナレーション',
            subtitle: 'レッスンの読み上げに使う声を選びます',
            saved: '保存しました',
            ttsUnavailable: '音声サービスに接続できません。しばらくしてからお試しください。',
            saveFailed: '保存に失敗しました。',
            loading: '読み込み中…',
            dialogueVoices: '対話の話者マッピング',
            dialogueVoicesHint: '話者ごとにナレーション声を割り当て',
        },
    } as const;

    const t = copy[language];
    const voices = getVoicesForUi(language);

    const showSavedToast = useCallback(() => {
        setSaved(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => {
            setSaved(false);
            savedTimerRef.current = null;
        }, 2000);
    }, []);

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
        return () => stopVoicePreview();
    }, [refresh]);

    const runPersistQueue = useCallback(async () => {
        if (persistInFlightRef.current) return;

        const job = persistQueueRef.current.shift();
        if (!job) return;

        const current = prefsRef.current;
        if (!current) {
            persistQueueRef.current.unshift(job);
            return;
        }

        persistInFlightRef.current = true;
        const previous = current;
        const optimistic = { ...current, ...job.options.optimistic, ...job.patch };
        prefsRef.current = optimistic;
        if (mountedRef.current) {
            setPrefs(optimistic);
            if (job.options.voiceId) setSavingVoiceId(job.options.voiceId);
            else setSavingAdvanced(true);
            setSaveError(null);
        }

        let result: TtsPreferences | null = null;
        try {
            result = await saveTtsPreferences(job.patch, language);
            prefsRef.current = result;
            if (mountedRef.current) {
                setPrefs(result);
                showSavedToast();
            }
        } catch {
            prefsRef.current = previous;
            if (mountedRef.current) {
                setPrefs(previous);
                setSaveError(t.saveFailed);
            }
        } finally {
            if (mountedRef.current) {
                setSavingVoiceId(null);
                setSavingAdvanced(false);
            }
            persistInFlightRef.current = false;
            job.resolve(result);
            if (mountedRef.current) {
                void runPersistQueue();
            }
        }
    }, [language, showSavedToast, t.saveFailed]);

    useEffect(() => {
        runPersistQueueRef.current = () => { void runPersistQueue(); };
    }, [runPersistQueue]);

    const persistPatch = useCallback((
        patch: Partial<TtsPreferences>,
        options: { optimistic?: Partial<TtsPreferences>; voiceId?: string } = {},
    ): Promise<TtsPreferences | null> => {
        return new Promise((resolve) => {
            persistQueueRef.current.push({ patch, options, resolve });
            void runPersistQueue();
        });
    }, [runPersistQueue]);

    const syncRecommendedVoice = useCallback(() => {
        const current = prefsRef.current;
        if (!current || current.auto_recommend === false || ttsUnavailableRef.current) {
            return;
        }
        const recommendedId = recommendVoiceId();
        if (recommendedId === current.voice_id) return;
        void persistPatch(
            { voice_id: recommendedId, auto_recommend: true },
            { optimistic: { voice_id: recommendedId, auto_recommend: true } },
        );
    }, [persistPatch]);

    useEffect(() => {
        if (loading) {
            hasSyncedOnLoadRef.current = false;
            return;
        }
        if (!prefs || hasSyncedOnLoadRef.current) return;
        hasSyncedOnLoadRef.current = true;
        syncRecommendedVoice();
    }, [loading, prefs, syncRecommendedVoice]);

    useEffect(() => {
        const onProfileChanged = () => syncRecommendedVoice();
        const onStorage = (event: StorageEvent) => {
            if (event.key === ASSESSMENT_PROFILE_STORAGE_KEY) syncRecommendedVoice();
        };
        const onVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            const now = Date.now();
            if (now - lastVisibilitySyncRef.current < 5000) return;
            lastVisibilitySyncRef.current = now;
            syncRecommendedVoice();
        };

        window.addEventListener(ASSESSMENT_PROFILE_CHANGED_EVENT, onProfileChanged);
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener(ASSESSMENT_PROFILE_CHANGED_EVENT, onProfileChanged);
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [syncRecommendedVoice]);

    const handleSelect = useCallback(async (voiceId: string) => {
        if (ttsUnavailableRef.current || !prefsRef.current || prefsRef.current.voice_id === voiceId) return;
        await persistPatch(
            { voice_id: voiceId, auto_recommend: false },
            { optimistic: { voice_id: voiceId, auto_recommend: false }, voiceId },
        );
    }, [persistPatch]);

    const handleSpeedChange = useCallback(async (speed: number) => {
        if (ttsUnavailableRef.current || !prefsRef.current) return;
        await persistPatch({ speed }, { optimistic: { speed } });
    }, [persistPatch]);

    const handleAutoRecommendChange = useCallback(async (enabled: boolean) => {
        if (ttsUnavailableRef.current || !prefsRef.current) return;

        if (!enabled) {
            await persistPatch({ auto_recommend: false }, { optimistic: { auto_recommend: false } });
            return;
        }

        const recommendedId = recommendVoiceId();
        await persistPatch(
            { auto_recommend: true, voice_id: recommendedId },
            { optimistic: { auto_recommend: true, voice_id: recommendedId } },
        );
    }, [persistPatch]);

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

    const listDisabled = ttsUnavailable || savingVoiceId !== null || savingAdvanced;

    return (
        <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
            <div className="max-w-2xl mx-auto space-y-8">
                <button
                    type="button"
                    onClick={() => onNavigate(ViewState.SETTINGS)}
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
                    {saveError && (
                        <p className="text-sm text-red-600">{saveError}</p>
                    )}
                </header>

                {ttsUnavailable && (
                    <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-sm text-amber-800">
                        {t.ttsUnavailable}
                    </div>
                )}

                {loading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-20 rounded-2xl bg-white border border-slate-100 animate-pulse" />
                        ))}
                        <p className="text-sm text-slate-400 text-center">{t.loading}</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <VoiceRecommendBanner
                            language={language}
                            autoRecommend={prefs?.auto_recommend !== false}
                            onNavigate={onNavigate}
                        />

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

                        {prefs && (
                            <VoiceAdvancedPanel
                                language={language}
                                prefs={prefs}
                                disabled={listDisabled}
                                onSpeedChange={handleSpeedChange}
                                onAutoRecommendChange={handleAutoRecommendChange}
                            />
                        )}

                        {isAdmin && (
                            <button
                                type="button"
                                onClick={() => onNavigate(ViewState.SETTINGS_DIALOGUE_VOICE)}
                                className="w-full text-left bg-white border border-slate-100 rounded-2xl px-4 py-4 hover:border-slate-200 transition-colors"
                            >
                                <p className="font-medium text-slate-800">{t.dialogueVoices}</p>
                                <p className="text-sm text-slate-500 mt-1">{t.dialogueVoicesHint}</p>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsVoiceView;