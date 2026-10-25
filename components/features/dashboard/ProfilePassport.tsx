import React, { useEffect, useState } from 'react';
import { LogOut, RotateCcw, Bell, Settings, ShieldCheck } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { usePlanEntry } from '../../../hooks/usePlanEntry';
import { clearLegacyBrowserKey, getLlmStatus, primaryProviderLabel, summarizeLlmStatus, type LlmStatus } from '../../../services/llmApi';
import { useAchievements, type AchievementsStatus } from '../../ui/achievementsClient';

/**
 * Phase 5: level, XP and the streak come from the server (useAchievements). Until there is an
 * answer for this learner the card shows 「—」, with a screen-reader text that says why.
 */
const NOT_READY_COPY = {
    en: {
        loading: 'Loading',
        unavailable: "Couldn't load",
        unsupported: 'XP and badges will be available soon',
        no_account: 'XP and badges are recorded when you sign in with a Rise Path account',
    },
    jp: {
        loading: '読み込んでいます',
        unavailable: '読み込めませんでした',
        unsupported: 'XP とバッジは、まもなく使えるようになります',
        no_account: 'XP とバッジは、Rise Path のアカウントでログインすると記録されます',
    },
} as const;

/** The screen-reader text for a status that has no numbers to show (exported for tests). */
export function notReadyText(language: 'en' | 'jp', status: AchievementsStatus): string {
    const t = NOT_READY_COPY[language];
    if (status === 'unavailable') return t.unavailable;
    if (status === 'unsupported') return t.unsupported;
    if (status === 'no_account') return t.no_account;
    return t.loading;
}

/** A number from the server, or 「—」 with the status's screen-reader text. */
const Stat: React.FC<{ value: string | null; language: 'en' | 'jp'; status: AchievementsStatus }> = ({ value, language, status }) => (
    value !== null ? <>{value}</> : (
        <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{notReadyText(language, status)}</span>
        </>
    )
);

interface ProfilePassportProps {
    onNavigate: (view: ViewState) => void;
}

const ProfilePassport: React.FC<ProfilePassportProps> = ({ onNavigate }) => {
    const { language } = useLanguage();
    const { user: authUser, logout } = useAuth();
    const achievements = useAchievements();
    const stats = achievements.status === 'ready' ? achievements.data : null;
    const [isFlipped, setIsFlipped] = useState(false);
    // Phase 3: the plan link only with VITE_FEATURE_BILLING and a GET /billing/me with eligibility 'ok' or a subscription.
    const showPlan = usePlanEntry();
    const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
    const [llmStatusFailed, setLlmStatusFailed] = useState(false);
    const copy = {
        en: {
            studentId: 'Student ID',
            identitySubtitle: 'Manage your identity and credentials.',
            campus: 'Rise Path Campus',
            idCard: 'ID card',
            active: 'Active',
            level: 'Level',
            xp: 'XP',
            flip: 'Flip',
            flipLabel: 'Show the back of the card',
            front: 'Front',
            frontLabel: 'Show the front of the card',
            passport: 'Digital passport',
            streak: 'Learning streak',
            streakValue: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
            totalXp: 'Total XP',
            roleGuest: 'Guest',
            roleMember: 'Learner',
            settings: 'Settings',
            editProfile: 'Edit profile details',
            mirror: 'Learning mirror',
            plan: 'Plan',
            notifications: 'Notifications',
            signOut: 'Sign out',
            footnote: 'Your card keeps your level, XP and settings in one place.',
            aiTitle: 'AI features',
            aiBody: 'AI runs securely on the server. No API key is needed.',
            aiChecking: 'Checking',
            aiLive: 'Active',
            aiDemo: 'Demo',
            aiOff: 'Off',
            aiUnreachable: 'Offline',
            aiDetails: 'View AI status',
        },
        jp: {
            studentId: '学生証',
            identitySubtitle: '身分情報と資格を管理します。',
            campus: 'Rise Path キャンパス',
            idCard: '学生証',
            active: '有効',
            level: 'レベル',
            xp: 'XP',
            flip: '裏返す',
            flipLabel: 'カードの裏面を見る',
            front: '表へ',
            frontLabel: 'カードの表面を見る',
            passport: 'デジタルパスポート',
            streak: '連続日数',
            streakValue: (n: number) => `${n}日`,
            totalXp: '合計XP',
            roleGuest: 'ゲスト',
            roleMember: '学習者',
            settings: '設定',
            editProfile: 'プロフィール編集',
            mirror: '学習の鏡',
            plan: 'プラン',
            notifications: '通知',
            signOut: 'ログアウト',
            footnote: 'レベル・XP・設定を、このカードにまとめています。',
            aiTitle: 'AI 機能',
            aiBody: 'AI はサーバーで安全に実行されています。API キーは不要です。',
            aiChecking: '確認中',
            aiLive: '利用可能',
            aiDemo: 'デモ',
            aiOff: '未設定',
            aiUnreachable: '接続不可',
            aiDetails: 'AI の状態を見る',
        }
    } as const;
    const t = copy[language];

    useEffect(() => {
        clearLegacyBrowserKey();
        const controller = new AbortController();
        getLlmStatus(controller.signal)
            .then(setLlmStatus)
            .catch(() => { if (!controller.signal.aborted) setLlmStatusFailed(true); });
        return () => controller.abort();
    }, []);

    const aiAvailability = summarizeLlmStatus(llmStatus, llmStatusFailed);
    const aiProvider = aiAvailability === 'live' ? primaryProviderLabel(llmStatus) : null;
    const aiBadge = {
        checking: t.aiChecking,
        live: t.aiLive,
        demo: t.aiDemo,
        off: t.aiOff,
        unreachable: t.aiUnreachable,
    }[aiAvailability];

    const user = {
        name: authUser?.name || 'Guest Explorer',
        role: !authUser || authUser.isGuest ? t.roleGuest : t.roleMember,
        level: stats ? String(stats.xp.level) : null,
        xp: stats ? String(stats.xp.total) : null,
        streak: stats ? t.streakValue(stats.streak.current) : null,
        // No stock photo of a stranger: the learner's own avatar, else their initials.
        avatar: authUser?.avatar || null,
    };
    const initials = user.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => Array.from(part)[0]?.toUpperCase() ?? '')
        .join('') || '?';

    return (
        <div className="min-h-screen bg-canvas flex flex-col items-center pt-12 pb-20 px-4 md:pt-24">

            {/* Page Header */}
            <div className="text-center mb-12">
                <h1 className="text-h1 text-fg mb-2">{t.studentId}</h1>
                <p className="text-body text-fg-2">{t.identitySubtitle}</p>
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
                                            <span className="block font-bold text-fg text-small leading-none">{t.campus}</span>
                                            <span className="eyebrow text-fg-3">{t.idCard}</span>
                                        </div>
                                    </div>
                                    <div className="bg-surface text-success px-2 py-1 rounded-chip text-caption font-bold border border-line shadow-1">
                                        {t.active}
                                    </div>
                                </div>

                                {/* Main Identity */}
                                <div className="flex gap-5 items-center mt-2">
                                    <div className="w-20 h-20 rounded-2xl bg-white shadow-inner border-[3px] border-white shrink-0 overflow-hidden relative group-hover:scale-105 transition-transform ring-1 ring-slate-100">
                                        {user.avatar ? (
                                            <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <span aria-hidden="true" className="grid h-full w-full place-items-center bg-primary-soft text-h2 font-bold text-primary-text">
                                                {initials}
                                            </span>
                                        )}
                                    </div>
                                    <div>
                                        <h2 className="text-h2 text-fg mb-1">{user.name}</h2>
                                        <p className="text-caption font-semibold text-primary-text bg-primary-soft px-2 py-0.5 rounded-chip w-fit">{user.role}</p>
                                    </div>
                                </div>

                                {/* Footer Stats & Action */}
                                <div className="flex items-end justify-between mt-2">
                                    <div className="flex gap-5">
                                        <div>
                                            <div className="eyebrow text-fg-3">{t.level}</div>
                                            <div className="tabular text-h3 font-bold text-fg leading-none mt-0.5"><Stat value={user.level} language={language} status={achievements.status} /></div>
                                        </div>
                                        <div>
                                            <div className="eyebrow text-fg-3">{t.xp}</div>
                                            <div className="tabular text-h3 font-bold text-fg leading-none mt-0.5"><Stat value={user.xp} language={language} status={achievements.status} /></div>
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setIsFlipped(true)}
                                        aria-label={t.flipLabel}
                                        className="flex items-center gap-1.5 text-caption font-bold text-fg-2 hover:text-primary-text transition-colors bg-surface border border-line hover:border-primary shadow-1 px-3 py-1.5 rounded-full"
                                    >
                                        <RotateCcw size={12} aria-hidden="true" /> {t.flip}
                                    </button>
                                </div>

                            </div>
                        </div>
                    </div>

                    {/* BACK: Settings / Data (dark tokens scoped to the card face) */}
                    <div
                        data-theme="dark"
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
                                    {t.passport}
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => setIsFlipped(false)}
                                    aria-label={t.frontLabel}
                                    className="text-caption font-bold text-fg-2 hover:text-fg transition-colors flex items-center gap-1"
                                >
                                    {t.front} <RotateCcw size={12} aria-hidden="true" />
                                </button>
                            </div>

                            {/* Scrollable Content Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-700">

                                {/* Quick Stats Row */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                                        <div className="eyebrow text-fg-3 mb-1">{t.streak}</div>
                                        <div className="tabular text-h2 text-fg"><Stat value={user.streak} language={language} status={achievements.status} /></div>
                                    </div>
                                    <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                                        <div className="eyebrow text-fg-3 mb-1">{t.totalXp}</div>
                                        <div className="tabular text-h2 text-fg"><Stat value={user.xp} language={language} status={achievements.status} /></div>
                                    </div>
                                </div>

                                {/* AI status — models run on the server; no key in the browser (WP-08) */}
                                <div className="bg-slate-800/30 rounded-xl p-3 border border-white/5 space-y-2">
                                    <div className="flex justify-between items-center gap-2">
                                        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
                                            <ShieldCheck size={14} className="text-emerald-400" aria-hidden="true" />
                                            {t.aiTitle}
                                        </span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${aiAvailability === 'live' ? 'text-emerald-300 bg-emerald-400/10' : 'text-amber-200 bg-amber-300/10'}`}>
                                            {aiProvider ? `${aiBadge} · ${aiProvider}` : aiBadge}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-300">{t.aiBody}</p>
                                    <button
                                        type="button"
                                        onClick={() => onNavigate(ViewState.SETTINGS_API_KEY)}
                                        className="w-full text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-2 rounded text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                                    >
                                        {t.aiDetails}
                                    </button>
                                </div>

                                {/* Account Actions */}
                                <div className="space-y-1">
                                    <button
                                        onClick={() => onNavigate(ViewState.SETTINGS)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        <span className="flex items-center gap-2"><Settings size={12} aria-hidden="true" /> {t.settings}</span>
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={() => onNavigate(ViewState.PROFILE_EDIT)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        {t.editProfile}
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={() => onNavigate(ViewState.PROFILE_MIRROR)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        {t.mirror}
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    {showPlan && (
                                        <button
                                            type="button"
                                            onClick={() => onNavigate(ViewState.SETTINGS_PLAN)}
                                            className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                        >
                                            {t.plan}
                                            <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => onNavigate(ViewState.NOTIFICATIONS)}
                                        className="w-full text-left p-2 hover:bg-white/5 rounded-lg text-xs font-medium text-slate-300 transition-colors flex justify-between items-center group"
                                    >
                                        <span className="flex items-center gap-2"><Bell size={12} aria-hidden="true" /> {t.notifications}</span>
                                        <span className="text-slate-600 group-hover:translate-x-1 transition-transform">→</span>
                                    </button>
                                    <button
                                        onClick={async () => {
                                            // Phase 5: false = stayed signed in (lesson records still unsaved).
                                            if ((await logout()) === false) return;
                                            window.location.href = '/';
                                        }}
                                        className="w-full text-left p-2 hover:bg-red-500/10 rounded-lg text-xs font-medium text-red-400 transition-colors flex items-center gap-2 mt-2"
                                    >
                                        <LogOut size={12} aria-hidden="true" /> {t.signOut}
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
                <Settings size={16} aria-hidden="true" />
                {t.settings}
            </button>

            <p className="mt-4 max-w-xs text-center text-caption text-fg-3">{t.footnote}</p>

        </div>
    );
};

export default ProfilePassport;
