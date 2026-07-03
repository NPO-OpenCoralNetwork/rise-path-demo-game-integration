import React from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';

interface AuthConfirmPendingViewProps {
    onBackToLogin: () => void;
}

const AuthConfirmPendingView: React.FC<AuthConfirmPendingViewProps> = ({ onBackToLogin }) => {
    const { language } = useLanguage();
    const [searchParams] = useSearchParams();
    const email = searchParams.get('email') || '';

    const copy = {
        en: {
            title: 'Check your email',
            body: email
                ? `We sent a confirmation link to ${email}. Open it to activate your account.`
                : 'We sent a confirmation link to your email. Open it to activate your account.',
            back: 'Back to Sign In',
        },
        jp: {
            title: 'メールを確認してください',
            body: email
                ? `確認リンクを ${email} に送信しました。メール内のリンクを開いてアカウントを有効化してください。`
                : '確認リンクをメールに送信しました。リンクを開いてアカウントを有効化してください。',
            back: 'ログインに戻る',
        },
    } as const;

    const t = copy[language];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-white px-6">
            <div className="relative w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-[2rem] p-8 shadow-2xl text-center space-y-6">
                <div className="inline-flex p-4 rounded-2xl bg-white/5 border border-white/10 mx-auto">
                    <Mail className="w-10 h-10 text-rose-500" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight uppercase font-mono">{t.title}</h1>
                <p className="text-sm text-white/50 leading-relaxed">{t.body}</p>
                <button
                    type="button"
                    onClick={onBackToLogin}
                    className="w-full group bg-white text-black py-4 rounded-full font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-105 transition-all"
                >
                    {t.back}
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
            </div>
        </div>
    );
};

export default AuthConfirmPendingView;