import React, { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Brain, ChevronRight, CircleAlert, CircleCheck, Download, Info, Shield, Trash2 } from 'lucide-react';
import { ViewState } from '../../../types';
import { features } from '../../../config/features';
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
    AiMemorySaveError,
    loadAiMemoryPrivacy,
    purgeAllLearnerMemories,
    saveAiMemoryPrivacy,
} from '../../../services/learnerMemoryService';
import LessonProgressDeleteSection from './LessonProgressDeleteSection';

interface SettingsPrivacyViewProps {
    onNavigate: (view: ViewState) => void;
}

const SettingsPrivacyView: React.FC<SettingsPrivacyViewProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { setTheme } = useTheme();
    const [allowDiaryExcerpts, setAllowDiaryExcerpts] = useState(false);
    // The Habit & Learning Chat (the only user of this setting) is off (features.agentChat), but the
    // learner turned excerpts on earlier: they can still turn it off. The saved value is kept.
    const [keptDiaryOptIn, setKeptDiaryOptIn] = useState(false);
    const [aiMemoryAvailable, setAiMemoryAvailable] = useState(true);
    // The learner opted in before this server stopped offering AI memory: they can still turn it off and purge.
    const [keptOptIn, setKeptOptIn] = useState(false);
    const [aiMemoryEnabled, setAiMemoryEnabled] = useState(false);
    const [allowConversationCapture, setAllowConversationCapture] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<'export' | 'delete' | 'memory-purge' | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState('');
    const [memoryDeleteConfirm, setMemoryDeleteConfirm] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // The two DELETE inputs are named by their headings (a placeholder is not a name).
    const memoryPurgeTitleId = useId();
    const deleteTitleId = useId();
    // ...and described by the paragraph that says to type DELETE (not every screen reader reads a placeholder).
    const memoryPurgeBodyId = useId();
    const deleteBodyId = useId();

    useEffect(() => { setTheme('default'); }, [setTheme]);

    useEffect(() => {
        let active = true;
        Promise.all([loadLifeJournalPrivacy(), loadAiMemoryPrivacy()])
            .then(([lifePrefs, memoryPrefs]) => {
                if (!active) return;
                setAllowDiaryExcerpts(lifePrefs.allow_diary_excerpts_in_ai);
                setKeptDiaryOptIn(!features.agentChat && lifePrefs.allow_diary_excerpts_in_ai);
                setAiMemoryAvailable(memoryPrefs.available);
                setKeptOptIn(!memoryPrefs.available && memoryPrefs.enabled);
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
            subtitle: 'Control how your lesson progress, life journal and AI memory are used and stored.',
            disclaimer: 'Life journal data is for learning habit insights only — not medical or psychological diagnosis.',
            diaryTitle: 'AI chat diary excerpts',
            diaryBody: 'When enabled, short diary excerpts may be sent to the AI coach during Habit & Learning Chat (opt-in per session). Default is off.',
            diaryEnabled: 'Allow diary excerpts in AI analysis',
            diaryNotOffered: 'The Habit & Learning Chat is not offered on this server, so no diary excerpts are sent.',
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
            aiMemoryNotOffered: 'Not offered on this server.',
            aiMemoryKeptOptIn: 'Your earlier opt-in is still saved. You can turn it off.',
            loading: 'Loading…',
            errorGeneric: 'Something went wrong. Please try again.',
            deleteAccountLead: 'To delete your whole account, use ',
            deleteAccountLink: 'Delete account',
            deleteAccountTail: '.',
            policyLead: 'For details, see the ',
            policyLink: 'Privacy Policy',
            policyTail: ' (in Japanese).',
        },
        jp: {
            back: '設定',
            title: 'プライバシー',
            subtitle: 'レッスンの進み具合、ライフジャーナル、AI 記憶の利用と保存を管理します。',
            disclaimer: 'ライフジャーナルは学習習慣の参考情報であり、医療・心理の診断ではありません。',
            diaryTitle: 'AI チャットへの日記抜粋',
            diaryBody: 'オンにすると「生活習慣×学習チャット」で短い日記抜粋を AI に送れます（セッションごとの明示 opt-in も必要）。既定はオフです。',
            diaryEnabled: 'AI 分析に日記抜粋を許可する',
            diaryNotOffered: 'このサーバーでは「生活習慣×学習チャット」を提供していないため、日記の抜粋は送りません。',
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
            aiMemoryNotOffered: 'このサーバーでは提供していません。',
            aiMemoryKeptOptIn: '以前のオンの設定が保存されています。オフにできます。',
            loading: '読み込み中…',
            errorGeneric: 'エラーが発生しました。もう一度お試しください。',
            deleteAccountLead: 'アカウントごと消すときは、',
            deleteAccountLink: '「アカウントを削除する」',
            deleteAccountTail: 'から手続きできます。',
            policyLead: 'くわしくは',
            policyLink: 'プライバシーポリシー',
            policyTail: 'を見てください。',
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
        } catch (e) {
            setAiMemoryEnabled(previousEnabled);
            setAllowConversationCapture(previousCapture);
            if ((e as AiMemorySaveError).errorType === 'ai_memory_not_offered') {
                // The server stopped offering AI memory since this page loaded; the card says so.
                setKeptOptIn(previousEnabled);
                setAiMemoryAvailable(false);
                return;
            }
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
        } catch (e) {
            setAllowConversationCapture(!checked);
            if ((e as AiMemorySaveError).errorType === 'ai_memory_not_offered') {
                setKeptOptIn(aiMemoryEnabled);
                setAiMemoryAvailable(false);
                return;
            }
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
        <div className="min-h-screen px-6 pt-12 pb-20">
            <div className="max-w-2xl mx-auto space-y-8">
                <button
                    type="button"
                    onClick={() => onNavigate(ViewState.SETTINGS)}
                    className="flex items-center gap-2 text-sm text-fg-2 hover:text-fg transition-colors"
                >
                    <ArrowLeft size={16} aria-hidden="true" /> {t.back}
                </button>

                <header className="space-y-2">
                    <h1 className="text-3xl font-bold text-fg">{t.title}</h1>
                    <p className="text-fg-2">{t.subtitle}</p>
                </header>

                {/* Phase 4: the policy, once published (VITE_FEATURE_LEGAL_PAGES=true). */}
                {features.legalPages && (
                    <p className="text-body text-fg-2">
                        {t.policyLead}
                        <Link to="/privacy" className="rounded-chip font-medium text-primary-text underline underline-offset-4">
                            {t.policyLink}
                        </Link>
                        {t.policyTail}
                    </p>
                )}

                {/* Phase 4 (D1): the whole account, not only these records. */}
                <p className="text-body text-fg-2">
                    {t.deleteAccountLead}
                    <Link to="/settings/delete-account" className="rounded-chip font-medium text-primary-text underline underline-offset-4">
                        {t.deleteAccountLink}
                    </Link>
                    {t.deleteAccountTail}
                </p>

                <p className="flex items-start gap-2 text-sm text-fg bg-sunken border border-line rounded-xl px-4 py-3">
                    <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
                    <span>{t.disclaimer}</span>
                </p>

                {loading ? (
                    <p className="text-sm text-fg-3">{t.loading}</p>
                ) : (
                    <div className="space-y-6">
                        <section className="bg-surface rounded-2xl border border-line shadow-1 p-5 space-y-4">
                            <div className="flex items-start gap-3">
                                <Shield size={20} aria-hidden="true" className="text-primary-text mt-0.5 shrink-0" />
                                <div className="space-y-1">
                                    <h2 className="font-semibold text-fg">{t.diaryTitle}</h2>
                                    <p className="text-sm text-fg-2">{features.agentChat ? t.diaryBody : t.diaryNotOffered}</p>
                                </div>
                            </div>
                            {(features.agentChat || keptDiaryOptIn) && (
                                <label
                                    className={`flex items-center gap-3 ${
                                        features.agentChat || allowDiaryExcerpts ? 'cursor-pointer' : 'cursor-not-allowed'
                                    }`}
                                >
                                    {/* Not offered: the earlier opt-in can only be turned off (as for AI memory below). */}
                                    <input
                                        type="checkbox"
                                        checked={allowDiaryExcerpts}
                                        aria-disabled={!features.agentChat && !allowDiaryExcerpts ? true : undefined}
                                        aria-describedby={!features.agentChat && allowDiaryExcerpts ? 'diary-kept-opt-in' : undefined}
                                        onChange={(e) => {
                                            if (features.agentChat || !e.target.checked) void handleDiaryToggle(e.target.checked);
                                        }}
                                        className="w-4 h-4 rounded accent-primary aria-disabled:opacity-50"
                                    />
                                    <span className="text-sm text-fg">{t.diaryEnabled}</span>
                                </label>
                            )}
                            {!features.agentChat && allowDiaryExcerpts && (
                                <p id="diary-kept-opt-in" className="text-sm text-fg-2">{t.aiMemoryKeptOptIn}</p>
                            )}
                        </section>

                        <section className="bg-surface rounded-2xl border border-line shadow-1 p-5 space-y-4">
                            <div className="flex items-start gap-3">
                                <Brain size={20} aria-hidden="true" className="text-primary-text mt-0.5 shrink-0" />
                                <div className="space-y-1">
                                    <h2 className="font-semibold text-fg">{t.aiMemoryTitle}</h2>
                                    {/* role="status": if a save is refused with 409, the toggle goes away and this text changes. */}
                                    <p role="status" className="text-sm text-fg-2">
                                        {aiMemoryAvailable ? t.aiMemoryBody : t.aiMemoryNotOffered}
                                    </p>
                                </div>
                            </div>
                            {(aiMemoryAvailable || keptOptIn) && (
                                <label
                                    className={`flex items-center gap-3 ${
                                        aiMemoryAvailable || aiMemoryEnabled ? 'cursor-pointer' : 'cursor-not-allowed'
                                    }`}
                                >
                                    {/* Not offered: the earlier opt-in can only be turned off. aria-disabled, not
                                        disabled, so keyboard focus stays on the checkbox after it is turned off. */}
                                    <input
                                        type="checkbox"
                                        checked={aiMemoryEnabled}
                                        aria-disabled={!aiMemoryAvailable && !aiMemoryEnabled ? true : undefined}
                                        aria-describedby={!aiMemoryAvailable && aiMemoryEnabled ? 'ai-memory-kept-opt-in' : undefined}
                                        onChange={(e) => {
                                            if (aiMemoryAvailable || !e.target.checked) void handleAiMemoryToggle(e.target.checked);
                                        }}
                                        className="w-4 h-4 rounded accent-primary aria-disabled:opacity-50"
                                    />
                                    <span className="text-sm text-fg">{t.aiMemoryEnabled}</span>
                                </label>
                            )}
                            {!aiMemoryAvailable && aiMemoryEnabled && (
                                <p id="ai-memory-kept-opt-in" className="text-sm text-fg-2">{t.aiMemoryKeptOptIn}</p>
                            )}
                            {aiMemoryAvailable && (aiMemoryEnabled ? (
                                <>
                                    <label className="flex items-center gap-3 cursor-pointer ml-1">
                                        <input
                                            type="checkbox"
                                            checked={allowConversationCapture}
                                            onChange={(e) => void handleCaptureToggle(e.target.checked)}
                                            className="w-4 h-4 rounded accent-primary"
                                        />
                                        <span className="text-sm text-fg">{t.aiCaptureEnabled}</span>
                                    </label>
                                    <p className="text-xs text-fg-3 ml-7">{t.aiCaptureHint}</p>
                                    <button
                                        type="button"
                                        onClick={() => onNavigate(ViewState.SETTINGS_AI_MEMORY)}
                                        className="flex items-center justify-between w-full rounded-xl border border-line px-4 py-3 text-sm text-fg hover:bg-sunken"
                                    >
                                        <span>{t.aiMemoryList}</span>
                                        <ChevronRight size={16} aria-hidden="true" className="text-fg-3" />
                                    </button>
                                </>
                            ) : (
                                <p className="text-sm text-fg-2">{t.aiMemoryExplain}</p>
                            ))}
                            {/* Purge stays for an earlier opt-in even when AI memory is not offered. */}
                            {(aiMemoryAvailable ? aiMemoryEnabled : keptOptIn) && (
                                <div className="pt-2 space-y-3 border-t border-line">
                                    <h3 id={memoryPurgeTitleId} className="text-sm font-semibold text-danger">{t.aiMemoryPurgeTitle}</h3>
                                    <p id={memoryPurgeBodyId} className="text-sm text-fg-2">{t.aiMemoryPurgeBody}</p>
                                    <input
                                        type="text"
                                        value={memoryDeleteConfirm}
                                        onChange={(e) => setMemoryDeleteConfirm(e.target.value)}
                                        placeholder="DELETE"
                                        aria-labelledby={memoryPurgeTitleId}
                                        aria-describedby={memoryPurgeBodyId}
                                        className="w-full rounded-xl border border-line-strong bg-surface px-4 py-2 text-sm text-fg placeholder:text-fg-3 focus:ring-2 focus:ring-danger outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void handleMemoryPurge()}
                                        disabled={busy !== null || memoryDeleteConfirm !== 'DELETE'}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-danger text-on-primary text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                                    >
                                        <Trash2 size={16} aria-hidden="true" />
                                        {busy === 'memory-purge' ? '…' : t.aiMemoryPurgeTitle}
                                    </button>
                                </div>
                            )}
                        </section>

                        <section className="bg-surface rounded-2xl border border-line shadow-1 p-5 space-y-4">
                            <h2 className="font-semibold text-fg">{t.exportTitle}</h2>
                            <p className="text-sm text-fg-2">{t.exportBody}</p>
                            <button
                                type="button"
                                onClick={() => void handleExport()}
                                disabled={busy !== null}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-primary-hover disabled:opacity-50"
                            >
                                <Download size={16} aria-hidden="true" />
                                {busy === 'export' ? '…' : t.exportButton}
                            </button>
                        </section>

                        <section className="bg-surface rounded-2xl border border-line shadow-1 p-5 space-y-4">
                            <h2 id={deleteTitleId} className="font-semibold text-danger">{t.deleteTitle}</h2>
                            <p id={deleteBodyId} className="text-sm text-fg-2">{t.deleteBody}</p>
                            <input
                                type="text"
                                value={deleteConfirm}
                                onChange={(e) => setDeleteConfirm(e.target.value)}
                                placeholder={t.deletePlaceholder}
                                aria-labelledby={deleteTitleId}
                                aria-describedby={deleteBodyId}
                                className="w-full rounded-xl border border-line-strong bg-surface px-4 py-2 text-sm text-fg placeholder:text-fg-3 focus:ring-2 focus:ring-danger outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => void handleDelete()}
                                disabled={busy !== null || deleteConfirm !== 'DELETE'}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-danger text-on-primary text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                            >
                                <Trash2 size={16} aria-hidden="true" />
                                {busy === 'delete' ? '…' : t.deleteButton}
                            </button>
                        </section>
                    </div>
                )}

                {/* Lesson progress does not wait for the journal and memory settings to load. */}
                <LessonProgressDeleteSection />

                {message && (
                    <p className="flex items-start gap-2 text-sm text-fg bg-sunken border border-line rounded-xl px-4 py-3">
                        <CircleCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                        <span>{message}</span>
                    </p>
                )}
                {error && (
                    <p className="flex items-start gap-2 text-sm text-fg bg-surface border border-line rounded-xl px-4 py-3">
                        <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
                        <span>{error}</span>
                    </p>
                )}
            </div>
        </div>
    );
};

export default SettingsPrivacyView;