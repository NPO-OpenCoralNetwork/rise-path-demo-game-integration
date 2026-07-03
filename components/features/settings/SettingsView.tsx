import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, Globe, Headphones, Key, MessageCircle, Shield, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import { useUserRole } from '../../../hooks/useUserRole';
import { checkTtsAvailable, getDisplayName, loadTtsPreferences } from '../../../services/ttsPreferencesService';
import { hasGeminiApiKey } from '../../../services/geminiApiKey';
import SettingsSection from './SettingsSection';
import SettingsRow from './SettingsRow';

interface SettingsViewProps {
    onNavigate: (view: ViewState) => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onNavigate }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { language, selectedLanguage, setLanguage } = useLanguage();
    const { setTheme } = useTheme();
    const { isAdmin } = useUserRole();
    const [voiceLabel, setVoiceLabel] = useState('');
    const [ttsStatus, setTtsStatus] = useState<'ok' | 'unavailable' | 'loading'>('loading');
    const [apiKeyStatus, setApiKeyStatus] = useState<'ok' | 'missing'>('missing');

    useEffect(() => { setTheme('default'); }, [setTheme]);

    useEffect(() => {
        let active = true;
        Promise.all([loadTtsPreferences(language), checkTtsAvailable()])
            .then(([prefs, available]) => {
                if (!active) return;
                setVoiceLabel(getDisplayName(prefs.voice_id, language));
                setTtsStatus(available ? 'ok' : 'unavailable');
            })
            .catch(() => {
                if (!active) return;
                setVoiceLabel('');
                setTtsStatus('unavailable');
            });
        return () => { active = false; };
    }, [language]);

    useEffect(() => {
        setApiKeyStatus(hasGeminiApiKey() ? 'ok' : 'missing');
    }, [location.key]);

    const copy = {
        en: {
            title: 'Settings',
            subtitle: 'Customize your account and learning experience',
            back: 'Back',
            learning: 'Learning',
            account: 'Account',
            advanced: 'Advanced',
            voice: 'Voice & Narration',
            voiceDefault: 'Lumina (default)',
            voiceUnavailable: 'Service unavailable',
            voiceLoading: 'Loading…',
            language: 'Display Language',
            languageValueEn: 'English',
            languageValueJp: 'Japanese',
            languageValueFr: 'French',
            languageHint: 'Tap to switch display language',
            profile: 'Edit Profile',
            notifications: 'Notifications',
            apiKey: 'API Key',
            apiKeyActive: 'Configured',
            apiKeyMissing: 'Not set',
            dialogueVoices: 'Dialogue voices',
            dialogueVoicesHint: 'Map speakers to narration voices',
            privacy: 'Privacy',
            comingSoon: 'Soon',
        },
        jp: {
            title: '設定',
            subtitle: 'アカウントと学習体験をカスタマイズ',
            back: '戻る',
            learning: '学習',
            account: 'アカウント',
            advanced: '詳細',
            voice: '音声とナレーション',
            voiceDefault: 'ルミナ（既定）',
            voiceUnavailable: 'サービス停止中',
            voiceLoading: '読み込み中…',
            language: '表示言語',
            languageValueEn: 'English',
            languageValueJp: '日本語',
            languageValueFr: 'Français',
            languageHint: 'タップして表示言語を切り替え',
            profile: 'プロフィール編集',
            notifications: '通知',
            apiKey: 'APIキー',
            apiKeyActive: '設定済み',
            apiKeyMissing: '未設定',
            dialogueVoices: '対話の話者マッピング',
            dialogueVoicesHint: '話者ごとにナレーション声を割り当て',
            privacy: 'プライバシー',
            comingSoon: '準備中',
        },
    } as const;

    const t = copy[language];

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            onNavigate(ViewState.PROFILE);
        }
    };

    const voiceSubtext = ttsStatus === 'loading'
        ? t.voiceLoading
        : ttsStatus === 'unavailable'
        ? t.voiceUnavailable
        : (voiceLabel || t.voiceDefault);

    const displayLanguageLabel = selectedLanguage === 'jp'
        ? t.languageValueJp
        : selectedLanguage === 'fr'
        ? t.languageValueFr
        : t.languageValueEn;

    const cycleDisplayLanguage = () => {
        setLanguage(selectedLanguage === 'en' ? 'jp' : selectedLanguage === 'jp' ? 'fr' : 'en');
    };

    return (
        <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
            <div className="max-w-2xl mx-auto space-y-8">
                <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                >
                    <ArrowLeft size={16} /> {t.back}
                </button>

                <header className="space-y-2">
                    <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
                    <p className="text-slate-500">{t.subtitle}</p>
                </header>

                <div className="space-y-8">
                    <SettingsSection title={t.learning}>
                        <SettingsRow
                            icon={<Headphones size={20} />}
                            label={t.voice}
                            subtext={voiceSubtext}
                            onClick={() => onNavigate(ViewState.SETTINGS_VOICE)}
                        />
                        <SettingsRow
                            icon={<Globe size={20} />}
                            label={t.language}
                            subtext={`${displayLanguageLabel} · ${t.languageHint}`}
                            onClick={cycleDisplayLanguage}
                        />
                        {isAdmin && (
                            <SettingsRow
                                icon={<MessageCircle size={20} />}
                                label={t.dialogueVoices}
                                subtext={t.dialogueVoicesHint}
                                onClick={() => onNavigate(ViewState.SETTINGS_DIALOGUE_VOICE)}
                            />
                        )}
                    </SettingsSection>

                    <SettingsSection title={t.account}>
                        <SettingsRow
                            icon={<User size={20} />}
                            label={t.profile}
                            onClick={() => onNavigate(ViewState.PROFILE_EDIT)}
                        />
                        <SettingsRow
                            icon={<Bell size={20} />}
                            label={t.notifications}
                            onClick={() => onNavigate(ViewState.NOTIFICATIONS)}
                        />
                    </SettingsSection>

                    <SettingsSection title={t.advanced}>
                        <SettingsRow
                            icon={<Key size={20} />}
                            label={t.apiKey}
                            subtext={apiKeyStatus === 'ok' ? t.apiKeyActive : t.apiKeyMissing}
                            onClick={() => onNavigate(ViewState.SETTINGS_API_KEY)}
                        />
                        <SettingsRow
                            icon={<Shield size={20} />}
                            label={t.privacy}
                            onClick={() => onNavigate(ViewState.SETTINGS_PRIVACY)}
                        />
                    </SettingsSection>
                </div>
            </div>
        </div>
    );
};

export default SettingsView;