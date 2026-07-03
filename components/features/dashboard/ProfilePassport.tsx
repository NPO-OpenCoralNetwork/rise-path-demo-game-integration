import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
    User, LogOut, RotateCcw, Bell, Settings
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { getGeminiApiKeyInfo, hasGeminiApiKey } from '../../../services/geminiApiKey';
import { getTotalXp, getLevel, getStreak } from '../../../services/gamificationService';

interface ProfilePassportProps {
    onNavigate: (view: ViewState) => void;
}

const ProfilePassport: React.FC<ProfilePassportProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { user: authUser, logout } = useAuth();
    const [isFlipped, setIsFlipped] = useState(false);
    const [apiKeyInfo, setApiKeyInfo] = useState(getGeminiApiKeyInfo());
    const copy = {
        en: {
            studentId: 'Student ID',
            identitySubtitle: 'Manage your identity and credentials.',
            apiKeyTitle: 'Gemini API Key',
            apiKeyActive: 'Active',
            apiKeyMissing: 'Missing',
            apiKeyManage: 'Manage in Settings',
            apiKeySourceEnv: 'Source: Environment',
            apiKeySourceLocal: 'Source: Browser storage',
            apiKeySourceNone: 'Source: Not set',
            apiKeyEnvHint: 'Environment key is active. Local key is ignored.',
        },
        jp: {
            studentId: '学生証',
            identitySubtitle: '身分情報と資格を管理します。',
            apiKeyTitle: 'Gemini APIキー',
            apiKeyActive: '設定済み',
            apiKeyMissing: '未設定',
            apiKeyManage: '設定で管理',
            apiKeySourceEnv: '設定元: 環境変数',
            apiKeySourceLocal: '設定元: ブラウザ保存',
            apiKeySourceNone: '設定元: 未設定',
            apiKeyEnvHint: '環境変数のキーが優先されます。',
        }
    } as const;
    const t = copy[language];
    const location = useLocation();

    useEffect(() => {
        setApiKeyInfo(getGeminiApiKeyInfo());
    }, [location.key]);

    const maskedKey = apiKeyInfo.key
        ? `${apiKeyInfo.key.slice(0, 4)}••••${apiKeyInfo.key.slice(-4)}`
        : '—';

    const apiKeySourceLabel = apiKeyInfo.source === 'env'
        ? t.apiKeySourceEnv
        : apiKeyInfo.source === 'local'
        ? t.apiKeySourceLocal
        : t.apiKeySourceNone;

    const user = {
        name: authUser?.name || 'Guest Explorer',
        id: authUser?.id?.slice(0, 12)?.toUpperCase() || 'LUM-0000-XX',
        role: authUser?.isGuest ? 'Guest' : 'Cadet Engineer',
        level: getLevel(),
        xp: getTotalXp(),
        streak: getStreak(),
        joined: "2024.11.01",
        email: authUser?.email || 'guest@risepath.system',
        avatar: authUser?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=400&q=80',
    };

    return (
        <div className="min-h-screen bg-slate-50/50 flex flex-col items-center pt-12 pb-20 px-4 md:pt-24">

            {/* Page Header */}
            <div className="text-center mb-12">
                <h1 className="text-3xl md:text-4xl font-bold text-slate-800 tracking-tight mb-2">{t.studentId}</h1>
                <p className="text-slate-500">{t.identitySubtitle}</p>
            </div>

            {/* 3D Flip Container - Using inline styles for reliable 3D transforms */}
            <div
                className="relative w-full max-w-[480px] h-[300px] group"
                style={{ perspective: '1000px' }}
            >
                <div
                    className="relative w-full h-full transition-all duration-700"
                    style={{
                        transformStyle: 'preserve-3d',
                        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
                    }}
                >

                    {/* FRONT: The ID Card */}
                    <div
                        className={`absolute inset-0 ${isFlipped ? 'pointer-events-none' : ''}`}
                        style={{ backfaceVisibility: 'hidden' }}
                    >
                        <div className="w-full h-full bg-gradient-to-br from-white via-slate-50 to-slate-200 rounded-3xl shadow-2xl overflow-hidden border border-white/60 relative flex flex-col ring-1 ring-white/50">

                            {/* Gloss Overlay */}
                            <div className="absolute inset-0 z-20 pointer-events-none bg-gradient-to-tr from-white/0 via-white/40 to-white/0 opacity-60 mix-blend-overlay"></div>
                            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/50 to-transparent pointer-events-none z-20 opacity-80"></div>

                            {/* Background Art */}
                            <div className="absolute inset-0 z-0 pointer-events-none opacity-60">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl translate-x-1/3 -translate-y-1/3"></div>
                                <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -translate-x-1/3 translate-y-1/3"></div>
                                {/* Grid Pattern */}
                                <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)', backgroundSize: '24px 24px', opacity: 0.2 }}></div>
                            </div>

                            {/* Card Content */}
                            <div className="relative z-10 p-6 flex flex-col h-full justify-between">

                                {/* Header */}
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-slate-900/20">L</div>
                                        <div>
                                            <span className="block font-bold tracking-tight text-slate-800 text-sm leading-none">Rise Path Campus</span>
                                            <span className="text-[10px] text-slate-500 font-mono">ID CARD</span>
                                        </div>
                                    </div>
                                    <div className="bg-emerald-100/80 backdrop-blur-sm text-emerald-700 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border border-emerald-200/50 shadow-sm">
                                        Active
                                    </div>
                                </div>

                                {/* Main Identity */}
                                <div className="flex gap-5 items-center mt-2">
                                    <div className="w-20 h-20 rounded-2xl bg-white shadow-inner border-[3px] border-white shrink-0 overflow-hidden relative group-hover:scale-105 transition-transform ring-1 ring-slate-100">
                                        <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-slate-900 leading-tight mb-1 drop-shadow-sm">{user.name}</h2>
                                        <p className="text-xs font-semibold text-indigo-700 bg-indigo-50/80 backdrop-blur-sm px-2 py-0.5 rounded-md w-fit border border-indigo-100">{user.role}</p>
                                    </div>
                                </div>

                                {/* Footer Stats & Action */}
                                <div className="flex items-end justify-between mt-2">
                                    <div className="flex gap-5">
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Level</div>
                                            <div className="text-lg font-bold text-slate-800 leading-none mt-0.5">{user.level}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">XP</div>
                                            <div className="text-lg font-bold text-slate-800 leading-none mt-0.5">{user.xp}</div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => setIsFlipped(true)}
                                        className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 hover:text-indigo-600 transition-colors bg-white/80 backdrop-blur-sm border border-slate-200/60 hover:border-indigo-200 shadow-sm px-3 py-1.5 rounded-full"
                                    >
                                        <RotateCcw size={10} /> Flip
                                    </button>
                                </div>

                            </div>
                        </div>
                    </div>

                    {/* BACK: Settings / Data */}
                    <div
                        className={`absolute inset-0 ${!isFlipped ? 'pointer-events-none' : ''}`}
                        style={{
                            backfaceVisibility: 'hidden',
                            transform: 'rotateY(180deg)'
                        }}
                    >
                        <div className="w-full h-full bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-700 relative text-slate-300 flex flex-col ring-1 ring-white/10">

                            {/* Header / Nav */}
                            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-slate-900/50 backdrop-blur-md z-10">
                                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                    Digital Passport
                                </h3>
                                <button
                                    onClick={() => setIsFlipped(false)}
                                    className="text-xs font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                                >
                                    Front <RotateCcw size={10} />
                                </button>
                            </div>

                            {/* Scrollable Content Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-700">

                                {/* Quick Stats Row */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                                        <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Learning Streak</div>
                                        <div className="text-xl font-bold text-white">{user.streak} {user.streak === 1 ? 'Day' : 'Days'}</div>
                                    </div>
                                    <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                                        <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Total XP</div>
                                        <div className="text-xl font-bold text-white">{user.xp}</div>
                                    </div>
                                </div>

                                {/* API Key summary — manage in Settings (Phase 17-C) */}
                                <div className="bg-slate-800/30 rounded-xl p-3 border border-white/5 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t.apiKeyTitle}</label>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${hasGeminiApiKey() ? 'text-emerald-400 bg-emerald-400/10' : 'text-amber-300 bg-amber-300/10'}`}>
                                            {hasGeminiApiKey() ? t.apiKeyActive : t.apiKeyMissing}
                                        </span>
                                    </div>
                                    <p className="text-[9px] text-slate-500">{apiKeySourceLabel}</p>
                                    <div className="flex items-center gap-2 bg-black/40 p-2 rounded border border-white/10 text-xs">
                                        <span className="font-mono text-slate-400 truncate flex-1">{maskedKey}</span>
                                    </div>
                                    {apiKeyInfo.source === 'env' && (
                                        <p className="text-[9px] text-amber-300">{t.apiKeyEnvHint}</p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onNavigate(ViewState.SETTINGS_API_KEY)}
                                        className="w-full text-[10px] bg-indigo-600 hover:bg-indigo-500 px-2 py-2 rounded text-white transition-colors"
                                    >
                                        {t.apiKeyManage}
                                    </button>
                                </div>

                                {/* Account Actions */}
                                <div className="space-y-1">
                                    <button
                                        onClick={() => onNavigate(ViewState.SETTINGS)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        <span className="flex items-center gap-2"><Settings size={12} /> {language === 'jp' ? '設定' : 'Settings'}</span>
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={() => onNavigate(ViewState.PROFILE_EDIT)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        {language === 'jp' ? 'プロフィール編集' : 'Edit Profile Details'}
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={() => onNavigate(ViewState.PROFILE_MIRROR)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        {language === 'jp' ? '学習の鏡' : 'Learning Mirror'}
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={() => onNavigate(ViewState.SUBSCRIPTION)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        {language === 'jp' ? 'サブスクリプション管理' : 'Manage Subscription'}
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={() => onNavigate(ViewState.NOTIFICATIONS)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        <span className="flex items-center gap-2"><Bell size={12} /> {language === 'jp' ? '通知' : 'Notifications'}</span>
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={async () => {
                                            await logout();
                                            window.location.href = '/';
                                        }}
                                        className="w-full text-left p-2 hover:bg-red-500/10 rounded-lg text-xs font-medium text-red-400 transition-colors flex items-center gap-2 mt-2"
                                    >
                                        <LogOut size={12} /> Sign Out
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <button
                type="button"
                onClick={() => onNavigate(ViewState.SETTINGS)}
                className="mt-6 flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
            >
                <Settings size={16} />
                {language === 'jp' ? '設定' : 'Settings'}
            </button>

            {/* Helper Text */}
            <div className="mt-4 text-center opacity-60">
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    This digital ID grants you access to all Rise Path facilities including the Vibe Coding cockpit and the Art Atelier.
                </p>
            </div>

        </div>
    );
};

export default ProfilePassport;
