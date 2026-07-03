import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Brain, Trash2 } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import {
    deleteLearnerMemory,
    LearnerMemoryItem,
    listLearnerMemories,
    loadAiMemoryPrivacy,
} from '../../../services/learnerMemoryService';

interface SettingsAiMemoryViewProps {
    onNavigate: (view: ViewState) => void;
}

const formatDate = (value?: string | null) => {
    if (!value) return '';
    try {
        return new Date(value).toLocaleDateString();
    } catch {
        return value;
    }
};

const SettingsAiMemoryView: React.FC<SettingsAiMemoryViewProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { setTheme } = useTheme();
    const [memories, setMemories] = useState<LearnerMemoryItem[]>([]);
    const [status, setStatus] = useState<string>('disabled');
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { setTheme('default'); }, [setTheme]);

    const copy = {
        en: {
            back: 'Privacy',
            title: 'AI memory',
            subtitle: 'Facts and preferences the coach remembers across sessions.',
            empty: 'No memories yet. Complete an assessment or tell the coach to remember something in chat.',
            disabled: 'AI memory is off. Enable it in Privacy settings first.',
            degraded: 'Memory service is temporarily unavailable. Try again later.',
            delete: 'Remove',
            type: 'Type',
            loading: 'Loading…',
            errorGeneric: 'Something went wrong. Please try again.',
        },
        jp: {
            back: 'プライバシー',
            title: 'AI の記憶',
            subtitle: 'コーチがセッションをまたいで覚えている傾向や好みです。',
            empty: 'まだ記憶がありません。診断を完了するか、チャットで「覚えておいて」と伝えてください。',
            disabled: 'AI 記憶はオフです。プライバシー設定で有効にしてください。',
            degraded: '記憶サービスが一時的に利用できません。後でもう一度お試しください。',
            delete: '削除',
            type: '種類',
            loading: '読み込み中…',
            errorGeneric: 'エラーが発生しました。もう一度お試しください。',
        },
    } as const;

    const t = copy[language];

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const privacy = await loadAiMemoryPrivacy();
            setEnabled(privacy.enabled);
            if (!privacy.enabled) {
                setMemories([]);
                setStatus('disabled');
                return;
            }
            const listed = await listLearnerMemories(50);
            setMemories(listed.memories);
            setStatus(listed.semantic_memory_status);
        } catch {
            setError(t.errorGeneric);
        } finally {
            setLoading(false);
        }
    }, [t.errorGeneric]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleDelete = useCallback(async (memoryId: string) => {
        setBusyId(memoryId);
        setError(null);
        try {
            await deleteLearnerMemory(memoryId);
            setMemories((prev) => prev.filter((item) => item.id !== memoryId));
        } catch {
            setError(t.errorGeneric);
        } finally {
            setBusyId(null);
        }
    }, [t.errorGeneric]);

    const emptyMessage = !enabled
        ? t.disabled
        : status === 'degraded'
        ? t.degraded
        : t.empty;

    return (
        <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
            <div className="max-w-2xl mx-auto space-y-8">
                <button
                    type="button"
                    onClick={() => onNavigate(ViewState.SETTINGS_PRIVACY)}
                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                >
                    <ArrowLeft size={16} /> {t.back}
                </button>

                <header className="space-y-2">
                    <div className="flex items-center gap-3">
                        <Brain size={28} className="text-indigo-600" />
                        <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
                    </div>
                    <p className="text-slate-500">{t.subtitle}</p>
                </header>

                {loading ? (
                    <p className="text-sm text-slate-400">{t.loading}</p>
                ) : memories.length === 0 ? (
                    <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-2xl px-4 py-5">
                        {emptyMessage}
                    </p>
                ) : (
                    <ul className="space-y-3">
                        {memories.map((memory) => (
                            <li
                                key={memory.id ?? memory.content}
                                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1 min-w-0">
                                        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wide">
                                            {t.type}: {memory.type ?? 'memory'}
                                        </p>
                                        <p className="text-sm text-slate-800 break-words">
                                            {memory.content}
                                        </p>
                                        {memory.created_at && (
                                            <p className="text-xs text-slate-400">
                                                {formatDate(memory.created_at)}
                                            </p>
                                        )}
                                    </div>
                                    {memory.id && (
                                        <button
                                            type="button"
                                            onClick={() => void handleDelete(memory.id!)}
                                            disabled={busyId !== null}
                                            className="shrink-0 inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800 disabled:opacity-50"
                                        >
                                            <Trash2 size={14} />
                                            {busyId === memory.id ? '…' : t.delete}
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
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

export default SettingsAiMemoryView;