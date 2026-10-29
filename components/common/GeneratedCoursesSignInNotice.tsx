import React from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import EmptyState from '../ui/EmptyState';
import { Button } from '../ui/Button';

const copy = {
  en: {
    title: 'Your generated courses could not be loaded',
    body: 'Your sign-in has ended, for example because it expired or you signed out on another device. Sign in again to see them.',
    signInAgain: 'Sign in again',
  },
  jp: {
    title: '生成したコースを読み込めませんでした',
    body: '期限が切れたり、ほかの端末でログアウトしたりして、ログインが切れています。もう一度ログインすると表示されます。',
    signInAgain: 'もう一度ログインする',
  },
} as const;

/**
 * Shown instead of an empty library or an error page when the generated-course API answers 401
 * (services/generatedCourses.ts isSignInRequired). Only a signed-in learner reaches it: the app
 * allows no guest without demo mode, and demo mode never calls the API for these courses. The
 * button signs out without asking (reason 'reauth'), and the landing page offers sign-in.
 */
const GeneratedCoursesSignInNotice: React.FC = () => {
  const { language } = useLanguage();
  const { logout } = useAuth();
  const t = copy[language];

  return (
    <div role="alert">
      <EmptyState
        tone="primary"
        headingLevel={2}
        icon={<LogIn size={20} />}
        title={t.title}
        description={t.body}
        action={(
          <Button size="sm" leadingIcon={<LogIn size={16} aria-hidden="true" />} onClick={() => { void logout({ reason: 'reauth' }); }}>
            {t.signInAgain}
          </Button>
        )}
      />
    </div>
  );
};

export default GeneratedCoursesSignInNotice;
