import React, { useEffect, useState } from 'react';
import type { Language } from '../../../context/LanguageContext';
import {
    clearGeminiApiKey,
    getGeminiApiKeyInfo,
    setGeminiApiKey,
} from '../../../services/geminiApiKey';

interface GeminiApiKeyFormProps {
    language: Language;
}

const GeminiApiKeyForm: React.FC<GeminiApiKeyFormProps> = ({ language }) => {
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [apiKeyNotice, setApiKeyNotice] = useState<string | null>(null);
    const [apiKeyInfo, setApiKeyInfo] = useState(getGeminiApiKeyInfo());

    const copy = {
        en: {
            statusActive: 'Active',
            statusMissing: 'Not set',
            placeholder: 'Paste your Gemini API key',
            save: 'Save',
            clear: 'Clear',
            saved: 'API key saved locally.',
            cleared: 'API key cleared.',
            empty: 'Please enter an API key.',
            sourceEnv: 'Source: Environment variable',
            sourceLocal: 'Source: Browser storage',
            sourceNone: 'Source: Not set',
            envHint: 'Environment key is active. Local key is ignored.',
            storageHint: 'Stored only in this browser.',
        },
        jp: {
            statusActive: '設定済み',
            statusMissing: '未設定',
            placeholder: 'Gemini APIキーを貼り付け',
            save: '保存',
            clear: '削除',
            saved: 'APIキーを保存しました。',
            cleared: 'APIキーを削除しました。',
            empty: 'APIキーを入力してください。',
            sourceEnv: '設定元: 環境変数',
            sourceLocal: '設定元: ブラウザ保存',
            sourceNone: '設定元: 未設定',
            envHint: '環境変数のキーが優先されます。',
            storageHint: 'このブラウザ内にのみ保存されます。',
        },
    } as const;

    const t = copy[language];

    useEffect(() => {
        setApiKeyInfo(getGeminiApiKeyInfo());
    }, []);

    const maskedKey = apiKeyInfo.key
        ? `${apiKeyInfo.key.slice(0, 4)}••••${apiKeyInfo.key.slice(-4)}`
        : '—';

    const sourceLabel = apiKeyInfo.source === 'env'
        ? t.sourceEnv
        : apiKeyInfo.source === 'local'
        ? t.sourceLocal
        : t.sourceNone;

    const handleSave = () => {
        const trimmed = apiKeyInput.trim();
        if (!trimmed) {
            setApiKeyNotice(t.empty);
            return;
        }
        setGeminiApiKey(trimmed);
        setApiKeyInput('');
        setApiKeyInfo(getGeminiApiKeyInfo());
        setApiKeyNotice(t.saved);
    };

    const handleClear = () => {
        clearGeminiApiKey();
        setApiKeyInput('');
        setApiKeyInfo(getGeminiApiKeyInfo());
        setApiKeyNotice(t.cleared);
    };

    return (
        <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-500">{sourceLabel}</p>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    apiKeyInfo.key
                        ? 'text-emerald-700 bg-emerald-50'
                        : 'text-amber-800 bg-amber-50'
                }`}>
                    {apiKeyInfo.key ? t.statusActive : t.statusMissing}
                </span>
            </div>

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-sm">
                <span className="font-mono text-slate-500 truncate flex-1">{maskedKey}</span>
            </div>

            <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={t.placeholder}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={handleSave}
                    className="flex-1 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2.5 rounded-xl transition-colors"
                >
                    {t.save}
                </button>
                <button
                    type="button"
                    onClick={handleClear}
                    className="flex-1 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2.5 rounded-xl transition-colors"
                >
                    {t.clear}
                </button>
            </div>

            {apiKeyInfo.source === 'env' && (
                <p className="text-xs text-amber-700">{t.envHint}</p>
            )}
            <p className="text-xs text-slate-500">{t.storageHint}</p>
            {apiKeyNotice && (
                <p className={`text-sm ${
                    apiKeyNotice === t.empty ? 'text-amber-700' : 'text-emerald-600'
                }`}>
                    {apiKeyNotice}
                </p>
            )}
        </div>
    );
};

export default GeminiApiKeyForm;