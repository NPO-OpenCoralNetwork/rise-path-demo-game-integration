import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { ArrowRight, Fingerprint, Lock, Mail, ShieldCheck, Terminal, User, UserCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { allowGuestLogin } from '../../services/authPolicy';
import { mapSignupErrorMessage, validateSignupForm } from '../../services/authFormValidation.ts';

export type AuthMode = 'login' | 'signup';

interface LoginViewProps {
    initialMode?: AuthMode;
    onLoginSuccess: () => void;
}

const ExperienceLoginView: React.FC<LoginViewProps> = ({ initialMode = 'login', onLoginSuccess }) => {
    const { language } = useLanguage();
    const navigate = useNavigate();
    const { login, loginAsGuest, signUp } = useAuth();
    const [mode, setMode] = useState<AuthMode>(initialMode);

    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [useNexloom, setUseNexloom] = useState(false);
    const hasSupabase = isSupabaseConfigured();
    const guestEnabled = allowGuestLogin();
    const emailInputRef = useRef<HTMLInputElement | null>(null);

    const copy = {
        en: {
            title: 'System Authentication',
            subtitle: 'Initialize your neural link to begin.',
            tabLogin: 'Sign In',
            tabSignup: 'Create Account',
            signupSubtitle: 'Save progress and reflections across sessions.',
            emailLabel: 'Identity (Email)',
            passwordLabel: 'Password',
            passwordConfirmLabel: 'Confirm Password',
            displayNameLabel: 'Display Name (optional)',
            displayNamePlaceholder: 'How should we call you?',
            nexloomBadge: 'NEXLOOM ID',
            nexloomCta: 'Sign in with Nexloom ID',
            nexloomDesc: 'Use the same email and password as your Nexloom workspace.',
            nexloomHint: 'Rise Path uses the same credentials as Nexloom. Enter your Nexloom email and password below.',
            guestCta: 'Access as Guest',
            guestDesc: 'Start exploring without persistent data.',
            loginCta: 'Verify Identity',
            signupCta: 'Create Account',
            hasAccount: 'Already have an account?',
            needAccount: 'New here?',
            switchLogin: 'Sign in',
            switchSignup: 'Create one',
            error: 'Authentication failed. Please check your credentials.',
            errorAlreadyRegistered: 'This email is already registered. Please sign in.',
            placeholder: 'identity@risepath.system',
        },
        jp: {
            title: 'システム認証',
            subtitle: '学習を開始するには、ニューラルリンクを初期化してください。',
            tabLogin: 'ログイン',
            tabSignup: '新規登録',
            signupSubtitle: '進捗と振り返りをアカウントに保存します。',
            emailLabel: 'ID (メールアドレス)',
            passwordLabel: 'パスワード',
            passwordConfirmLabel: 'パスワード（確認）',
            displayNameLabel: '表示名（任意）',
            displayNamePlaceholder: '呼び名を入力',
            nexloomBadge: 'NEXLOOM ID',
            nexloomCta: 'Nexloom IDでログイン',
            nexloomDesc: 'Nexloom ワークスペースと同じメールアドレスとパスワードを使います。',
            nexloomHint: 'Rise Path は Nexloom と同じ認証情報で入れます。下の欄に Nexloom のメールアドレスとパスワードを入力してください。',
            guestCta: 'ゲストとしてアクセス',
            guestDesc: 'データを保存せずに探索を開始します。',
            loginCta: 'アイデンティティを確認',
            signupCta: 'アカウントを作成',
            hasAccount: 'すでにアカウントをお持ちですか？',
            needAccount: '初めての方は',
            switchLogin: 'ログイン',
            switchSignup: '新規登録',
            error: '認証に失敗しました。情報を確認してください。',
            errorAlreadyRegistered: 'このメールアドレスは既に登録されています。ログインしてください。',
            placeholder: 'identity@risepath.system',
        },
    } as const;

    const t = copy[language];
    const isSignup = mode === 'signup';

    const switchMode = (next: AuthMode) => {
        setMode(next);
        setError(null);
        setNotice(null);
        setUseNexloom(false);
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setNotice(null);
        try {
            await login(
                email || 'guest@risepath.system', 
                password || 'password',
                { useNexloomAuth: useNexloom }
            );
            onLoginSuccess();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t.error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setNotice(null);

        const validationError = validateSignupForm({
            email,
            password,
            passwordConfirm,
            displayName,
        });
        if (validationError) {
            setError(validationError.message);
            return;
        }

        setIsLoading(true);
        try {
            const result = await signUp(email, password, { displayName: displayName.trim() || undefined });
            if (result.status === 'session_ready') {
                onLoginSuccess();
                return;
            }
            navigate(`/auth/confirm-pending?email=${encodeURIComponent(result.email)}`, { replace: true });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t.error;
            if (mapSignupErrorMessage(message) === 'already_registered') {
                setError(t.errorAlreadyRegistered);
            } else {
                setError(message);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleGuestLogin = () => {
        if (!guestEnabled) return;
        setIsLoading(true);
        try {
            loginAsGuest();
            setTimeout(() => {
                onLoginSuccess();
            }, 500);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t.error);
            setIsLoading(false);
        }
    };

    const handleNexloomLogin = () => {
        switchMode('login');
        setUseNexloom(true);
        setError(null);
        setNotice(t.nexloomHint);
        emailInputRef.current?.focus();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

            <div className="relative w-full max-w-md p-1 px-6">
                <div className="absolute inset-0 bg-rose-500/20 blur-[100px] rounded-full pointer-events-none" />

                <div className="relative bg-[#0a0a0a] border border-white/10 rounded-[2rem] p-8 shadow-2xl backdrop-blur-xl overflow-hidden">
                    <div className="text-center mb-8">
                        <div className="inline-flex p-4 rounded-2xl bg-white/5 border border-white/10 mb-6 animate-pulse">
                            <Fingerprint className="w-10 h-10 text-rose-500" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white mb-2 uppercase font-mono">{t.title}</h1>
                        <p className="text-white/40 text-sm">{isSignup ? t.signupSubtitle : t.subtitle}</p>
                    </div>

                    <div className="flex rounded-full bg-white/5 border border-white/10 p-1 mb-8">
                        <button
                            type="button"
                            onClick={() => switchMode('login')}
                            className={`flex-1 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
                                !isSignup ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                            }`}
                        >
                            {t.tabLogin}
                        </button>
                        <button
                            type="button"
                            onClick={() => switchMode('signup')}
                            className={`flex-1 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
                                isSignup ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                            }`}
                        >
                            {t.tabSignup}
                        </button>
                    </div>

                    {!isSignup && (
                        <>
                            <button
                                type="button"
                                onClick={handleNexloomLogin}
                                disabled={isLoading}
                                className="w-full group relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-1 transition-all hover:border-rose-500/30 hover:bg-white/[0.05] disabled:opacity-50"
                            >
                                <div className="flex items-center gap-4 rounded-[1.35rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-4 py-4 text-left">
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f43f5e_0%,#fb7185_45%,#fda4af_100%)] text-sm font-black tracking-[0.24em] text-black shadow-[0_12px_32px_rgba(244,63,94,0.22)]">
                                        N
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/35">
                                            {t.nexloomBadge}
                                        </div>
                                        <div className="mt-1 text-sm font-semibold text-white">
                                            {t.nexloomCta}
                                        </div>
                                        <div className="mt-1 text-[11px] text-white/35">
                                            {t.nexloomDesc}
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 shrink-0 text-white/35 transition-transform group-hover:translate-x-1 group-hover:text-rose-300" />
                                </div>
                            </button>

                            <div className="flex items-center gap-4 my-8 text-white/10">
                                <div className="h-[1px] flex-1 bg-current" />
                                <span className="text-[10px] font-mono uppercase tracking-widest">OR</span>
                                <div className="h-[1px] flex-1 bg-current" />
                            </div>
                        </>
                    )}

                    <form onSubmit={isSignup ? handleSignup : handleLogin} className="space-y-5">
                        <div>
                            <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2 ml-4">
                                {t.emailLabel}
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                                <input
                                    ref={emailInputRef}
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={t.placeholder}
                                    autoComplete="email"
                                    className="w-full bg-white/5 border border-white/10 rounded-full py-4 pl-12 pr-6 text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all placeholder:text-white/10"
                                />
                            </div>
                        </div>

                        {(hasSupabase || isSignup) && (
                            <div>
                                <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2 ml-4">
                                    {t.passwordLabel}
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        autoComplete={isSignup ? 'new-password' : 'current-password'}
                                        className="w-full bg-white/5 border border-white/10 rounded-full py-4 pl-12 pr-6 text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all placeholder:text-white/10"
                                    />
                                </div>
                            </div>
                        )}

                        {isSignup && (
                            <>
                                <div>
                                    <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2 ml-4">
                                        {t.passwordConfirmLabel}
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                                        <input
                                            type="password"
                                            value={passwordConfirm}
                                            onChange={(e) => setPasswordConfirm(e.target.value)}
                                            placeholder="••••••••"
                                            autoComplete="new-password"
                                            className="w-full bg-white/5 border border-white/10 rounded-full py-4 pl-12 pr-6 text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all placeholder:text-white/10"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2 ml-4">
                                        {t.displayNameLabel}
                                    </label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                                        <input
                                            type="text"
                                            value={displayName}
                                            onChange={(e) => setDisplayName(e.target.value)}
                                            placeholder={t.displayNamePlaceholder}
                                            autoComplete="name"
                                            className="w-full bg-white/5 border border-white/10 rounded-full py-4 pl-12 pr-6 text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all placeholder:text-white/10"
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {error && (
                            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono">
                                [ERROR]: {error}
                            </div>
                        )}

                        {notice && (
                            <div className="p-4 rounded-xl border border-amber-400/20 bg-amber-500/10 text-[11px] font-mono text-amber-100">
                                [NOTICE]: {notice}
                            </div>
                        )}

                        <button
                            disabled={isLoading}
                            className="w-full group bg-white text-black py-4 rounded-full font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-105 transition-all disabled:opacity-50 shadow-xl shadow-white/5"
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                            ) : (
                                <>
                                    {isSignup ? t.signupCta : t.loginCta}
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>

                        <p className="text-center text-[11px] text-white/40 font-mono">
                            {isSignup ? t.hasAccount : t.needAccount}{' '}
                            <button
                                type="button"
                                onClick={() => switchMode(isSignup ? 'login' : 'signup')}
                                className="text-rose-300 hover:text-rose-200 underline underline-offset-2"
                            >
                                {isSignup ? t.switchLogin : t.switchSignup}
                            </button>
                        </p>
                    </form>

                    {!isSignup && guestEnabled && (
                        <button
                            onClick={handleGuestLogin}
                            disabled={isLoading}
                            className="w-full mt-6 group bg-white/5 border border-white/10 text-white p-6 rounded-[1.5rem] text-left hover:bg-white/10 transition-all flex items-center gap-4"
                        >
                            <div className="w-12 h-12 rounded-xl bg-black border border-white/10 flex items-center justify-center text-white/60 group-hover:text-rose-400 transition-colors">
                                <UserCircle className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold uppercase tracking-wider">{t.guestCta}</h3>
                                <p className="text-[10px] text-white/30 font-mono">{t.guestDesc}</p>
                            </div>
                            <Terminal className="w-4 h-4 text-white/20" />
                        </button>
                    )}
                </div>

                <div className="mt-8 text-center">
                    <div className="inline-flex items-center gap-2 text-[10px] font-mono text-white/20 uppercase tracking-[0.3em]">
                        <ShieldCheck className="w-3 h-3 text-emerald-500/50" />
                        Secure Neural Channel: Active
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExperienceLoginView;