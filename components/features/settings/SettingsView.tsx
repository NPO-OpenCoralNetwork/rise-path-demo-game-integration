import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, Flag, Globe, Headphones, MessageCircle, Shield, ShieldCheck, Sparkles, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import { useUserRole } from '../../../hooks/useUserRole';
import { useAuth } from '../../../context/AuthContext';
import { getAiAccess, type AiAccessStatus } from '../../../services/aiAccessApi';
import { checkTtsAvailable, getDisplayName, loadTtsPreferences } from '../../../services/ttsPreferencesService';
import { clearLegacyBrowserKey, getLlmStatus, primaryProviderLabel, summarizeLlmStatus, type LlmStatus } from '../../../services/llmApi';
import SettingsSection from './SettingsSection';
import SettingsRow from './SettingsRow';

interface SettingsViewProps {
    onNavigate: (view: ViewState) => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onNavigate }) => {
    const navigate = useNavigate();
    const { language, selectedLanguage, setLanguage } = useLanguage();
    const { setTheme } = useTheme();
    const { isAdmin } = useUserRole();
    const { user } = useAuth();
    const [aiAccess, setAiAccess] = useState<AiAccessStatus | null>(null);
    const [voiceLabel, setVoiceLabel] = useState('');
    const [ttsStatus, setTtsStatus] = useState<'ok' | 'unavailable' | 'loading'>('loading');
    const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
    const [llmStatusFailed, setLlmStatusFailed] = useState(false);

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
        if (!user || user.isGuest) return;
        const controller = new AbortController();
        getAiAccess(controller.signal)
            .then(setAiAccess)
            .catch(() => { /* The row still opens the page, which explains the error. */ });
        return () => controller.abort();
    }, [user?.id, user?.isGuest]);

    useEffect(() => {
        clearLegacyBrowserKey();
        const controller = new AbortController();
        getLlmStatus(controller.signal)
            .then(setLlmStatus)
            .catch(() => { if (!controller.signal.aborted) setLlmStatusFailed(true); });
        return () => controller.abort();
    }, []);

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
            ai: 'AI features',
            aiChecking: 'Checking…',
            aiLive: (provider: string | null) => `Runs securely on the server${provider ? ` · ${provider}` : ''}`,
            aiDemo: 'Demo mode · sample answers',
            aiOff: 'Not configured on this server',
            aiUnreachable: 'Server unreachable',
            dialogueVoices: 'Dialogue voices',
            dialogueVoicesHint: 'Map speakers to narration voices',
            privacy: 'Privacy',
            comingSoon: 'Soon',
            safety: 'AI and safety',
            aiAccess: 'AI access',
            aiAccessHint: 'Birth year and month, guardian consent',
            aiAccessReady: 'You can use AI',
            aiAccessReadyMinor: 'Guardian agreed · you can use AI',
            aiAccessNeedsAge: 'Enter your birth year and month to use AI',
            aiAccessNeedsConsent: 'A guardian needs to agree before you use AI',
            aiAccessPaused: 'AI is resting for today',
            adminSafety: 'Safety administration',
            adminSafetyHint: 'Reports, safety counts, paper consent forms',
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
            ai: 'AI 機能',
            aiChecking: '確認中…',
            aiLive: (provider: string | null) => `サーバーで安全に実行中${provider ? `・${provider}` : ''}`,
            aiDemo: 'デモモード・サンプル回答',
            aiOff: 'このサーバーでは未設定',
            aiUnreachable: 'サーバーに接続できません',
            dialogueVoices: '対話の話者マッピング',
            dialogueVoicesHint: '話者ごとにナレーション声を割り当て',
            privacy: 'プライバシー',
            comingSoon: '準備中',
            safety: 'AI と安全',
            aiAccess: 'AI の利用設定',
            aiAccessHint: '生まれた年と月、保護者の同意',
            aiAccessReady: 'AI を使えます',
            aiAccessReadyMinor: '保護者の同意ずみ・AI を使えます',
            aiAccessNeedsAge: 'AI を使うには、生まれた年と月を登録してください',
            aiAccessNeedsConsent: 'AI を使うには、保護者の同意が必要です',
            aiAccessPaused: '今日は AI をお休みしています',
            adminSafety: '安全の管理',
            adminSafetyHint: '報告、止めた件数、紙の同意書の記録',
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

    const aiAvailability = summarizeLlmStatus(llmStatus, llmStatusFailed);
    const aiSubtext = aiAvailability === 'live'
        ? t.aiLive(primaryProviderLabel(llmStatus))
        : aiAvailability === 'demo'
        ? t.aiDemo
        : aiAvailability === 'off'
        ? t.aiOff
        : aiAvailability === 'unreachable'
        ? t.aiUnreachable
        : t.aiChecking;

    const aiAccessSubtext = !aiAccess
        ? t.aiAccessHint
        : aiAccess.status === 'needs_age'
        ? t.aiAccessNeedsAge
        : aiAccess.status === 'needs_guardian_consent'
        ? t.aiAccessNeedsConsent
        : aiAccess.status === 'paused'
        ? t.aiAccessPaused
        : aiAccess.audience === 'minor'
        ? t.aiAccessReadyMinor
        : t.aiAccessReady;

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

                    <SettingsSection title={t.safety}>
                        <SettingsRow
                            icon={<ShieldCheck size={20} />}
                            label={t.aiAccess}
                            subtext={aiAccessSubtext}
                            onClick={() => onNavigate(ViewState.SETTINGS_AI_ACCESS)}
                        />
                        {isAdmin && (
                            <SettingsRow
                                icon={<Flag size={20} />}
                                label={t.adminSafety}
                                subtext={t.adminSafetyHint}
                                onClick={() => onNavigate(ViewState.SETTINGS_ADMIN_SAFETY)}
                            />
                        )}
                    </SettingsSection>

                    <SettingsSection title={t.advanced}>
                        <SettingsRow
                            icon={<Sparkles size={20} />}
                            label={t.ai}
                            subtext={aiSubtext}
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