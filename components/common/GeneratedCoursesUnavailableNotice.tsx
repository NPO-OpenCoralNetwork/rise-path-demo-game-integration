import React from 'react';
import { CloudOff } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import EmptyState from '../ui/EmptyState';

const copy = {
  en: {
    title: 'Your generated courses could not be loaded',
    body: "Your sign-in can't be checked right now. Please try again in a little while.",
  },
  jp: {
    title: '生成したコースを読み込めませんでした',
    body: 'いまはログインの確認ができません。しばらくしてから、もう一度開いてください。',
  },
} as const;

/**
 * Shown instead of an empty library or an error page when the generated-course API answers 503
 * auth_unavailable (services/generatedCourses.ts isSignInUnavailable): the API could not reach the
 * auth provider, so it could not check the sign-in. The session may be fine, so the notice asks to
 * try again later and has no sign-in button (GeneratedCoursesSignInNotice is for a 401).
 */
const GeneratedCoursesUnavailableNotice: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language];

  return (
    <div role="alert">
      <EmptyState
        tone="neutral"
        headingLevel={2}
        icon={<CloudOff size={20} />}
        title={t.title}
        description={t.body}
      />
    </div>
  );
};

export default GeneratedCoursesUnavailableNotice;
