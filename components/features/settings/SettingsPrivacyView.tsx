import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Brain, ChevronRight, Download, Shield, Trash2 } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import {
    deleteAllLifeJournalData,
    downloadLifeJournalExport,
    exportLifeJournalData,
    loadLifeJournalPrivacy,
    saveLifeJournalPrivacy,
} from '../../../services/lifeJournalPrivacyService';
import {
    loadAiMemoryPrivacy,
    purgeAllLearnerMemories,
    saveAiMemoryPrivacy,
} from '../../../services/learnerMemoryService';

interface SettingsPrivacyViewProps {
    onNavigate: (view: ViewState) => void;
}

const SettingsPrivacyView: React.FC<SettingsPrivacyViewProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { setTheme } = useTheme();
    const [allowDiaryExcerpts, setAllowDiaryExcerpts] = useState(false);
    const [aiMemoryEnabled, setAiMemoryEnabled] = useState(false);
    const [allowConversationCapture, setAllowConversationCapture] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<'export' | 'delete' | 'memory-purge' | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState('');
    const [memoryDeleteConfirm, setMemoryDeleteConfirm] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { setTheme('default'); }, [setTheme]);

    useEffect(() => {
        let active = true;
        Promise.all([loadLifeJournalPrivacy(), loadAiMemoryPrivacy()])
            .then(([lifePrefs, memoryPrefs]) => {
                if (!active) return;
                setAllowDiaryExcerpts(lifePrefs.allow_diary_excerpts_in_ai);
                setAiMemoryEnabled(memoryPrefs.enabled);
                setAllowConversationCapture(memoryPrefs.allow_conversation_capture);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, []);

    const copy = {
        en: {
            back: 'Settings',
            title: 'Privacy',
            subtitle: 'Control how your life journal data is used and stored.',
            disclaimer: 'Life journal data is for learning habit insights only — not medical or psychological diagnosis.',
            diaryTitle: 'AI chat diary excerpts',
            diaryBody: 'When enabled, short diary excerpts may be sent to the AI coach during Habit & Learning Chat (opt-in per session). Default is off.',
            diaryEnabled: 'Allow diary excerpts in AI analysis',
            exportTitle: 'Export data',
            exportBody: 'Download your journal entries as JSON (up to 366 days).',
            exportButton: 'Download JSON',
            exportDone: 'Export started.',
            deleteTitle: 'Delete all journal data',
            deleteBody: 'Permanently removes daily reflections, lifestyle logs, and cached analysis. Type DELETE to confirm.',
            deletePlaceholder: 'DELETE',
            deleteButton: 'Delete all data',
            deleteDone: 'All life journal data was deleted.',
            aiMemoryTitle: 'AI personal memory',
            aiMemoryBody: 'When enabled, the coach can remember learning preferences across chats (opt-in, default off).',
            aiMemoryEnabled: 'Let AI remember personal tendencies',
            aiCaptureEnabled: 'Automatically remember tendencies from conversations',
            aiCaptureHint: 'Only explicit chat capture when the parent toggle is on.',
            aiMemoryList: 'View remembered items',
            aiMemoryPurgeTitle: 'Delete all AI memories',
            aiMemoryPurgeBody: 'Removes semantic memories only. Life journal data is not affected. Type DELETE to confirm.',
            aiMemoryPurgeDone: 'All AI memories were deleted.',
            aiMemoryExplain: 'AI memory is off. Enable the toggle above to let the coach remember your preferences.',
            loading: 'Loading…',
            errorGeneric: 'Something went wrong. Please try again.',
        },
        jp: {
            back: '設定',
            title: 'プライバシー',
            subtitle: 'ライフジャーナルデータの利用と保存を管理します。',
            disclaimer: 'ライフジャーナルは学習習慣の参考情報であり、医療・心理の診断ではありません。',
            diaryTitle: 'AI チャットへの日記抜粋',
            diaryBody: 'オンにすると「生活習慣×学習チャット」で短い日記抜粋を AI に送れます（セッションごとの明示 opt-in も必要）。既定はオフです。',
            diaryEnabled: 'AI 分析に日記抜粋を許可する',
            exportTitle: 'データのエクスポート',
            exportBody: 'ジャーナルを JSON でダウンロードします（最大 366 日）。',
            exportButton: 'JSON をダウンロード',
            exportDone: 'エクスポートを開始しました。',
            deleteTitle: 'ジャーナルデータをすべて削除',
            deleteBody: '日次の振り返り・生活ログ・分析キャッシュを完全に削除します。確認のため DELETE と入力してください。',
            deletePlaceholder: 'DELETE',
            deleteButton: 'すべて削除',
            deleteDone: 'ライフジャーナルデータを削除しました。',
            aiMemoryTitle: 'AI 個人記憶',
            aiMemoryBody: 'オンにすると、コーチがチャットをまたいで学習の傾向を覚えられます（opt-in・既定オフ）。',
            aiMemoryEnabled: 'AI に個人的な傾向を覚えさせる',
            aiCaptureEnabled: '会話から傾向を自動で記憶する',
            aiCaptureHint: '親トグルがオンのときのみ、会話からの自動記憶が有効になります。',
            aiMemoryList: '覚えていること一覧',
            aiMemoryPurgeTitle: 'AI 記憶をすべて削除',
            aiMemoryPurgeBody: 'セマンティック記憶のみ削除します。ライフジャーナルには影響しません。確認のため DELETE と入力してください。',
            aiMemoryPurgeDone: 'AI 記憶をすべて削除しました。',
            aiMemoryExplain: 'AI 記憶はオフです。上のトグルをオンにすると、コーチがあなたの傾向を覚えられます。',
            loading: '読み込み中…',
            errorGeneric: 'エラーが発生しました。もう一度お試しください。',
        },
    } as const;

    const t = copy[language];

    const handleDiaryToggle = useCallback(async (checked: boolean) => {
        setAllowDiaryExcerpts(checked);
        setError(null);
        try {
            await saveLifeJournalPrivacy({ allow_diary_excerpts_in_ai: checked });
        } catch {
            setAllowDiaryExcerpts(!checked);
            setError(t.errorGeneric);
        }
    }, [t.errorGeneric]);

    const handleExport = useCallback(async () => {
        setBusy('export');
        setError(null);
        setMessage(null);
        try {
            const payload = await exportLifeJournalData();
            downloadLifeJournalExport(payload);
            setMessage(t.exportDone);
        } catch {
            setError(t.errorGeneric);
        } finally {
            setBusy(null);
        }
    }, [t.errorGeneric, t.exportDone]);

    const handleAiMemoryToggle = useCallback(async (checked: boolean) => {
        const previousEnabled = aiMemoryEnabled;
        const previousCapture = allowConversationCapture;
        setAiMemoryEnabled(checked);
        if (!checked) setAllowConversationCapture(false);
        setError(null);
        try {
            const saved = await saveAiMemoryPrivacy({
                enabled: checked,
                allow_conversation_capture: checked ? allowConversationCapture : false,
            });
            setAiMemoryEnabled(saved.enabled);
            setAllowConversationCapture(saved.allow_conversation_capture);
        } catch {
            setAiMemoryEnabled(previousEnabled);
            setAllowConversationCapture(previousCapture);
            setError(t.errorGeneric);
        }
    }, [aiMemoryEnabled, allowConversationCapture, t.errorGeneric]);

    const handleCaptureToggle = useCallback(async (checked: boolean) => {
        if (!aiMemoryEnabled) return;
        setAllowConversationCapture(checked);
        setError(null);
        try {
            const saved = await saveAiMemoryPrivacy({ allow_conversation_capture: checked });
            setAllowConversationCapture(saved.allow_conversation_capture);
        } catch {
            setAllowConversationCapture(!checked);
            setError(t.errorGeneric);
        }
    }, [aiMemoryEnabled, t.errorGeneric]);

    const handleMemoryPurge = useCallback(async () => {
        if (memoryDeleteConfirm !== 'DELETE') return;
        setBusy('memory-purge');
        setError(null);
        setMessage(null);
        try {
            await purgeAllLearnerMemories();
            setMemoryDeleteConfirm('');
            setMessage(t.aiMemoryPurgeDone);
        } catch {
            setError(t.errorGeneric);
        } finally {
            setBusy(null);
        }
    }, [memoryDeleteConfirm, t.aiMemoryPurgeDone, t.errorGeneric]);

    const handleDelete = useCallback(async () => {
        if (deleteConfirm !== 'DELETE') return;
        setBusy('delete');
        setError(null);
        setMessage(null);
        try {
            await deleteAllLifeJournalData();
            setDeleteConfirm('');
            setMessage(t.deleteDone);
        } catch {
            setError(t.errorGeneric);
        } finally {
            setBusy(null);
        }
    }, [deleteConfirm, t.deleteDone, t.errorGeneric]);

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
                </header>

                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    {t.disclaimer}
                </p>

                {loading ? (
                    <p className="text-sm text-slate-400">{t.loading}</p>
                ) : (
                    <div className="space-y-6">
                        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                            <div className="flex items-start gap-3">
                                <Shield size={20} className="text-indigo-600 mt-0.5 shrink-0" />
                                <div className="space-y-1">
                                    <h2 className="font-semibold text-slate-900">{t.diaryTitle}</h2>
                                    <p className="text-sm text-slate-500">{t.diaryBody}</p>
                                </div>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={allowDiaryExcerpts}
                                    onChange={(e) => void handleDiaryToggle(e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-slate-700">{t.diaryEnabled}</span>
                            </label>
                        </section>

                        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                            <div className="flex items-start gap-3">
                                <Brain size={20} className="text-indigo-600 mt-0.5 shrink-0" />
                                <div className="space-y-1">
                                    <h2 className="font-semibold text-slate-900">{t.aiMemoryTitle}</h2>
                                    <p className="text-sm text-slate-500">{t.aiMemoryBody}</p>
                                </div>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={aiMemoryEnabled}
                                    onChange={(e) => void handleAiMemoryToggle(e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-slate-700">{t.aiMemoryEnabled}</span>
                            </label>
                            {aiMemoryEnabled ? (
                                <>
                                    <label className="flex items-center gap-3 cursor-pointer ml-1">
                                        <input
                                            type="checkbox"
                                            checked={allowConversationCapture}
                                            onChange={(e) => void handleCaptureToggle(e.target.checked)}
                                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-sm text-slate-700">{t.aiCaptureEnabled}</span>
                                    </label>
                                    <p className="text-xs text-slate-400 ml-7">{t.aiCaptureHint}</p>
                                    <button
                                        type="button"
                                        onClick={() => onNavigate(ViewState.SETTINGS_AI_MEMORY)}
                                        className="flex items-center justify-between w-full rounded-xl border border-slate-100 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
                                    >
                                        <span>{t.aiMemoryList}</span>
                                        <ChevronRight size={16} className="text-slate-400" />
                                    </button>
                                    <div className="pt-2 space-y-3 border-t border-slate-100">
                                        <h3 className="text-sm font-semibold text-rose-800">{t.aiMemoryPurgeTitle}</h3>
                                        <p className="text-sm text-slate-500">{t.aiMemoryPurgeBody}</p>
                                        <input
                                            type="text"
                                            value={memoryDeleteConfirm}
                                            onChange={(e) => setMemoryDeleteConfirm(e.target.value)}
                                            placeholder="DELETE"
                                            className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm focus:ring-2 focus:ring-rose-300 outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => void handleMemoryPurge()}
                                            disabled={busy !== null || memoryDeleteConfirm !== 'DELETE'}
                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
                                        >
                                            <Trash2 size={16} />
                                            {busy === 'memory-purge' ? '…' : t.aiMemoryPurgeTitle}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <p className="text-sm text-slate-500">{t.aiMemoryExplain}</p>
                            )}
                        </section>

                        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                            <h2 className="font-semibold text-slate-900">{t.exportTitle}</h2>
                            <p className="text-sm text-slate-500">{t.exportBody}</p>
                            <button
                                type="button"
                                onClick={() => void handleExport()}
                                disabled={busy !== null}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                            >
                                <Download size={16} />
                                {busy === 'export' ? '…' : t.exportButton}
                            </button>
                        </section>

                        <section className="bg-white rounded-2xl border border-rose-100 shadow-sm p-5 space-y-4">
                            <h2 className="font-semibold text-rose-800">{t.deleteTitle}</h2>
                            <p className="text-sm text-slate-500">{t.deleteBody}</p>
                            <input
                                type="text"
                                value={deleteConfirm}
                                onChange={(e) => setDeleteConfirm(e.target.value)}
                                placeholder={t.deletePlaceholder}
                                className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm focus:ring-2 focus:ring-rose-300 outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => void handleDelete()}
                                disabled={busy !== null || deleteConfirm !== 'DELETE'}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
                            >
                                <Trash2 size={16} />
                                {busy === 'delete' ? '…' : t.deleteButton}
                            </button>
                        </section>
                    </div>
                )}

                {message && (
                    <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                        {message}
                    </p>
                )}
                {error && (
                    <p className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
};

export default SettingsPrivacyView;