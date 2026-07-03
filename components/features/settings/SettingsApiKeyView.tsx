import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import GeminiApiKeyForm from './GeminiApiKeyForm';

interface SettingsApiKeyViewProps {
    onNavigate: (view: ViewState) => void;
}

const SettingsApiKeyView: React.FC<SettingsApiKeyViewProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { setTheme } = useTheme();

    useEffect(() => { setTheme('default'); }, [setTheme]);

    const copy = {
        en: {
            back: 'Settings',
            title: 'API Key',
            subtitle: 'Configure your Gemini API key for AI diagnosis and course generation.',
        },
        jp: {
            back: '設定',
            title: 'APIキー',
            subtitle: 'AI診断やカリキュラム生成に使う Gemini APIキーを設定します。',
        },
    } as const;

    const t = copy[language];

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

                <GeminiApiKeyForm language={language} />
            </div>
        </div>
    );
};

export default SettingsApiKeyView;