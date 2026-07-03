import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getSupabaseClient } from '../../services/supabaseClient';

interface AuthCallbackViewProps {
    onSuccess: () => void;
}

const AuthCallbackView: React.FC<AuthCallbackViewProps> = ({ onSuccess }) => {
    const { language } = useLanguage();
    const [error, setError] = useState<string | null>(null);

    const copy = {
        en: {
            loading: 'Confirming your session…',
            error: 'Could not complete sign-in. Please try logging in again.',
        },
        jp: {
            loading: 'セッションを確認しています…',
            error: 'サインインを完了できませんでした。もう一度ログインしてください。',
        },
    } as const;

    const t = copy[language];

    useEffect(() => {
        let active = true;
        const supabase = getSupabaseClient();
        if (!supabase) {
            setError(t.error);
            return;
        }

        supabase.auth.getSession()
            .then(({ data: { session }, error: sessionError }) => {
                if (!active) return;
                if (sessionError) {
                    setError(sessionError.message);
                    return;
                }
                if (session) {
                    onSuccess();
                    return;
                }
                setError(t.error);
            })
            .catch(() => {
                if (active) setError(t.error);
            });

        return () => { active = false; };
    // Run once on mount; parent onSuccess is stable enough for navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-white">
            <div className="text-center space-y-4 px-6">
                {!error ? (
                    <>
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-rose-500" />
                        <p className="text-sm font-mono text-white/60">{t.loading}</p>
                    </>
                ) : (
                    <p className="text-sm font-mono text-rose-400 max-w-sm">{error}</p>
                )}
            </div>
        </div>
    );
};

export default AuthCallbackView;