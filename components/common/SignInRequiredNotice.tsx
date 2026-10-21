import React from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import EmptyState from '../ui/EmptyState';
import { Button } from '../ui/Button';

const copy = {
  en: {
    title: 'Sign in to see your generated courses',
    bodyGuest: 'You can keep reading lessons as a guest. Generated courses are saved to an account, so sign in to see them here.',
    bodyExpired: 'Your sign-in has expired, so your generated courses could not be loaded. Sign out, then sign in again to see them.',
    action: 'Go to sign-in',
    actionAgain: 'Sign out and sign in again',
  },
  jp: {
    title: '生成したコースを見るにはログインが必要です',
    bodyGuest: 'ゲストのままでも教材は読めます。生成したコースはアカウントに保存されるので、ログインするとここに表示されます。',
    bodyExpired: 'ログインの有効期限が切れたため、生成したコースを読み込めませんでした。一度ログアウトしてから、もう一度ログインしてください。',
    action: 'ログイン画面へ',
    actionAgain: 'ログアウトしてログインし直す',
  },
} as const;

/**
 * Shown when the generated-course API answers 401 (sign-in expired, or a guest), instead of an
 * empty library. The button signs out; the landing page then offers sign-in.
 */
const SignInRequiredNotice: React.FC = () => {
  const { language } = useLanguage();
  const { user, logout } = useAuth();
  const t = copy[language];
  const expired = Boolean(user && !user.isGuest);

  return (
    <div role="alert">
      <EmptyState
        tone="primary"
        headingLevel={2}
        icon={<LogIn size={20} />}
        title={t.title}
        description={expired ? t.bodyExpired : t.bodyGuest}
        action={(
          <Button size="sm" leadingIcon={<LogIn size={16} aria-hidden="true" />} onClick={() => { void logout(); }}>
            {expired ? t.actionAgain : t.action}
          </Button>
        )}
      />
    </div>
  );
};

export default SignInRequiredNotice;
