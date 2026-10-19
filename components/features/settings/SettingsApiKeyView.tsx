import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleDashed, ShieldCheck } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import {
    clearLegacyBrowserKey,
    getLlmStatus,
    primaryProviderLabel,
    summarizeLlmStatus,
    type LlmStatus,
} from '../../../services/llmApi';

interface SettingsApiKeyViewProps {
    onNavigate: (view: ViewState) => void;
}

const SettingsApiKeyView: React.FC<SettingsApiKeyViewProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { setTheme } = useTheme();
    const [status, setStatus] = useState<LlmStatus | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => { setTheme('default'); }, [setTheme]);

    useEffect(() => {
        clearLegacyBrowserKey();
        const controller = new AbortController();
        getLlmStatus(controller.signal)
            .then((next) => { setStatus(next); setFailed(false); })
            .catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
    }, []);

    const copy = {
        en: {
            back: 'Settings',
            title: 'AI features',
            subtitle: 'AI feedback, diagnosis and the AI tutor run on Rise Path servers. You do not need an API key.',
            secureTitle: 'AI runs securely on the server',
            secureBody: 'Model keys are managed by the server administrator. Nothing is stored in this browser, and your text is sent only when you ask the AI for help.',
            checking: 'Checking…',
            live: 'Active',
            demo: 'Demo mode',
            off: 'Not configured',
            unreachable: 'Server unreachable',
            liveDetail: (provider: string | null) => (provider ? `Answers come from ${provider}.` : 'Answers come from the configured AI provider.'),
            demoDetail: 'No AI provider is configured on this server, so AI features show sample answers.',
            offDetail: 'No AI provider is configured on this server. AI features are unavailable.',
            unreachableDetail: 'Could not reach the server. Check your connection and try again.',
            providersTitle: 'Providers on this server',
            claude: 'Claude (Anthropic)',
            gemini: 'Gemini (Google)',
            mock: 'Sample answers',
            configured: 'Configured',
            notConfigured: 'Not configured',
            on: 'On',
            offLabel: 'Off',
        },
        jp: {
            back: '設定',
            title: 'AI 機能',
            subtitle: '文章フィードバック、学習診断、AI先生は Rise Path のサーバーで動いています。API キーの入力は必要ありません。',
            secureTitle: 'AI はサーバーで安全に実行されています',
            secureBody: 'モデルのキーはサーバーの管理者が管理しています。このブラウザには何も保存されず、文章は AI に質問したときだけ送信されます。',
            checking: '確認中…',
            live: '利用可能',
            demo: 'デモモード',
            off: '未設定',
            unreachable: 'サーバーに接続できません',
            liveDetail: (provider: string | null) => (provider ? `${provider} が回答します。` : '設定された AI が回答します。'),
            demoDetail: 'このサーバーには AI プロバイダーが設定されていないため、AI 機能はサンプルの回答を表示します。',
            offDetail: 'このサーバーには AI プロバイダーが設定されていません。AI 機能は利用できません。',
            unreachableDetail: 'サーバーに接続できませんでした。通信環境を確認して、もう一度お試しください。',
            providersTitle: 'このサーバーのプロバイダー',
            claude: 'Claude（Anthropic）',
            gemini: 'Gemini（Google）',
            mock: 'サンプル回答',
            configured: '設定済み',
            notConfigured: '未設定',
            on: 'オン',
            offLabel: 'オフ',
        },
    } as const;

    const t = copy[language];
    const availability = summarizeLlmStatus(status, failed);
    const badgeClass = availability === 'live'
        ? 'text-emerald-700 bg-emerald-50'
        : availability === 'checking'
        ? 'text-slate-600 bg-slate-100'
        : 'text-amber-800 bg-amber-50';
    const detail = availability === 'live'
        ? t.liveDetail(primaryProviderLabel(status))
        : availability === 'demo'
        ? t.demoDetail
        : availability === 'off'
        ? t.offDetail
        : availability === 'unreachable'
        ? t.unreachableDetail
        : null;

    const providerRows = status
        ? [
            { key: 'anthropic', label: t.claude, active: status.providers.anthropic.configured, value: status.providers.anthropic.configured ? t.configured : t.notConfigured },
            { key: 'gemini', label: t.gemini, active: status.providers.gemini.configured, value: status.providers.gemini.configured ? t.configured : t.notConfigured },
            { key: 'mock', label: t.mock, active: status.mock, value: status.mock ? t.on : t.offLabel },
        ]
        : [];

    return (
        <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
            <div className="max-w-2xl mx-auto space-y-8">
                <button
                    type="button"
                    onClick={() => onNavigate(ViewState.SETTINGS)}
                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                    <ArrowLeft size={16} aria-hidden="true" /> {t.back}
                </button>

                <header className="space-y-2">
                    <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
                    <p className="text-slate-500">{t.subtitle}</p>
                </header>

                <section aria-labelledby="ai-secure-title" className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        <span className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                            <ShieldCheck size={20} aria-hidden="true" />
                        </span>
                        <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 id="ai-secure-title" className="text-base font-semibold text-slate-900">{t.secureTitle}</h2>
                                <span role="status" className={`text-xs font-semibold px-2 py-1 rounded-full ${badgeClass}`}>
                                    {t[availability]}
                                </span>
                            </div>
                            <p className="text-sm text-slate-600">{t.secureBody}</p>
                            {detail && <p className="text-sm text-slate-700">{detail}</p>}
                        </div>
                    </div>
                </section>

                {providerRows.length > 0 && (
                    <section aria-labelledby="ai-providers-title" className="space-y-3">
                        <h2 id="ai-providers-title" className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{t.providersTitle}</h2>
                        <ul className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-100">
                            {providerRows.map((row) => (
                                <li key={row.key} className="flex items-center justify-between gap-3 px-5 py-3.5">
                                    <span className="flex items-center gap-2 text-sm text-slate-800">
                                        {row.active
                                            ? <CheckCircle2 size={16} className="text-emerald-600" aria-hidden="true" />
                                            : <CircleDashed size={16} className="text-slate-500" aria-hidden="true" />}
                                        {row.label}
                                    </span>
                                    <span className={`text-sm ${row.active ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>{row.value}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </div>
    );
};

export default SettingsApiKeyView;
