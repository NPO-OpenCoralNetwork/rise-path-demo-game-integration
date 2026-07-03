import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { adachiService } from '../../services/adachiService';
import { useLanguage } from '../../context/LanguageContext';

interface LoginViewProps {
    onLoginSuccess: (user: any) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
    const { language, selectedLanguage, setLanguage } = useLanguage();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const copy = {
        en: {
            subtitle: 'Sign in to your learning journey',
            emailPlaceholder: 'Email address',
            passwordPlaceholder: 'Password',
            errorInvalid: "Invalid email or password. (Hint: Don't use 'error' in email)",
            signingIn: 'Signing in...',
            signIn: 'Sign In',
            quickLogin: 'Quick Login (Guest / Mock)',
            quickLoginFailed: 'Quick Login failed. Please try again.',
            forgotPassword: 'Forgot Password?',
            createAccount: 'Create Account',
            footer: '© 2024 Rise Path Platform. Powered by Adachi AI.'
        },
        jp: {
            subtitle: '学習の旅にサインイン',
            emailPlaceholder: 'メールアドレス',
            passwordPlaceholder: 'パスワード',
            errorInvalid: "メールアドレスまたはパスワードが正しくありません。（ヒント: emailに 'error' を含めないでください）",
            signingIn: 'サインイン中...',
            signIn: 'サインイン',
            quickLogin: 'クイックログイン (ゲスト / モック)',
            quickLoginFailed: 'クイックログインに失敗しました。もう一度お試しください。',
            forgotPassword: 'パスワードを忘れた？',
            createAccount: 'アカウント作成',
            footer: '© 2024 Rise Path Platform. Powered by Adachi AI.'
        }
    } as const;
    const t = copy[language];

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const result = await adachiService.login(email, password);
            console.log("Login success:", result);
            // Simulate a "welcome" delay for effect
            setTimeout(() => {
                onLoginSuccess(result.user);
            }, 500);
        } catch (err) {
            setError(t.errorInvalid);
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 relative overflow-hidden font-sans">

            {/* Ambient Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
                <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse delay-1000"></div>
                <div className="absolute top-[40%] left-[40%] w-[30%] h-[30%] bg-emerald-500/10 rounded-full blur-[100px] animate-pulse delay-2000"></div>
            </div>

            {/* Glassmorphic Card */}
            <div className="relative z-10 w-full max-w-md p-8 m-4 bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl animate-in fade-in zoom-in duration-700">
                <div className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-white/10 border border-white/20 p-1">
                    <button
                        type="button"
                        onClick={() => setLanguage('en')}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${selectedLanguage === 'en' ? 'bg-white text-slate-900' : 'text-white/70 hover:text-white'}`}
                        aria-pressed={selectedLanguage === 'en'}
                    >
                        EN
                    </button>
                    <button
                        type="button"
                        onClick={() => setLanguage('jp')}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${selectedLanguage === 'jp' ? 'bg-white text-slate-900' : 'text-white/70 hover:text-white'}`}
                        aria-pressed={selectedLanguage === 'jp'}
                    >
                        JP
                    </button>
                    <button
                        type="button"
                        onClick={() => setLanguage('fr')}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${selectedLanguage === 'fr' ? 'bg-white text-slate-900' : 'text-white/70 hover:text-white'}`}
                        aria-pressed={selectedLanguage === 'fr'}
                    >
                        FR
                    </button>
                </div>

                {/* Header */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30 mb-6">
                        <Sparkles className="text-white w-8 h-8" />
                    </div>
                    <h1 className="text-4xl font-bold text-white tracking-tight mb-2">Rise Path</h1>
                    <p className="text-slate-400 text-sm">{t.subtitle}</p>
                </div>

                {/* Form */}
                <form onSubmit={handleLogin} className="space-y-6">

                    {/* Email Input */}
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Mail className="h-5 w-5 text-slate-400 group-focus-within:text-purple-400 transition-colors" />
                        </div>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="block w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
                            placeholder={t.emailPlaceholder}
                        />
                    </div>

                    {/* Password Input */}
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Lock className="h-5 w-5 text-slate-400 group-focus-within:text-purple-400 transition-colors" />
                        </div>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="block w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
                            placeholder={t.passwordPlaceholder}
                        />
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-sm text-center animate-in slide-in-from-top-2">
                            {error}
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full relative py-4 px-6 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-[length:200%_auto] hover:bg-right transition-all duration-500 text-white font-bold shadow-lg shadow-indigo-600/30 disabled:opacity-70 disabled:cursor-not-allowed group overflow-hidden mb-3"
                    >
                        <div className="relative z-10 flex items-center justify-center gap-2">
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>{t.signingIn}</span>
                                </>
                            ) : (
                                <>
                                    <span>{t.signIn}</span>
                                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </div>
                    </button>

                    {/* Quick Login Button (Dev/Guest) */}
                    <button
                        type="button"
                        disabled={isLoading}
                        onClick={async () => {
                            setEmail("demo@rise-path.ai");
                            setPassword("password");
                            setIsLoading(true);

                            try {
                                // Simulate mock login delay
                                await new Promise(resolve => setTimeout(resolve, 500));
                                const result = await adachiService.login("demo@rise-path.ai", "password");
                                console.log("Quick Login Success:", result);
                                setTimeout(() => onLoginSuccess(result.user), 500);
                            } catch (err) {
                                console.error("Quick Login Failed:", err);
                                setError(t.quickLoginFailed);
                                setIsLoading(false);
                            }
                        }}
                        className="w-full py-3 px-6 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 hover:border-slate-600 text-slate-300 font-medium transition-all text-sm"
                    >
                        {t.quickLogin}
                    </button>

                    {/* Footer Links */}
                    <div className="flex items-center justify-between text-sm text-slate-400 mt-8">
                        <button type="button" className="hover:text-white transition-colors">{t.forgotPassword}</button>
                        <button type="button" className="hover:text-white transition-colors">{t.createAccount}</button>
                    </div>

                </form>
            </div>

            {/* Footer Credit */}
            <div className="absolute bottom-6 text-slate-600 text-xs text-center w-full">
                {t.footer}
            </div>
        </div>
    );
};

export default LoginView;
