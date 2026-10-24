import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { ButtonLink } from '../../ui/Button';
import { PublicPageShell } from '../../ui/PublicPageShell';
import { SupportContact } from '../../ui/SupportContact';
import { readDeletedPage, type DeletedBy } from '../../../services/accountDeletionState';

/**
 * /account/deleted — after a Rise Path account's data was deleted (Phase 4, design §5.11). Public:
 * the deletion signed this device out (App.tsx PUBLIC_PATHS; inside the Layout only when someone
 * is signed in again). Everything comes from the URL, nothing from storage:
 *   - by=self (this device deleted it): what happened, the time in Japan time when `at` is a
 *     valid time from the last 24 hours, what stays, when to sign in again;
 *   - by=other or anything else (another device, staff, a sign-in within the 30 s margin, or a
 *     direct visit): the neutral page, true for anyone who lands here.
 * Focus starts on the heading, so a screen reader reads the outcome first.
 */

const copy = {
  en: {
    selfTitle: 'Your Rise Path data has been deleted',
    selfAt: (time: string) => `Deleted on ${time} (Japan time). Saving this page can help if you need to check later.`,
    selfBody:
      'Your learning records, courses, life journal, AI memories and other Rise Path data have been deleted, and this device is signed out. This cannot be undone.',
    login:
      'Your sign-in (email, password and the name you registered with) is kept because Nexloom and P-School use it too. Signing in with the same email starts an empty account. Please wait about a minute before signing in again.',
    otherTitle: 'This Rise Path account has been deleted',
    otherBody: 'We removed its records from this device and signed you out.',
    pschool: 'P-School also needs a Rise Path sign-in, so using it creates an empty Rise Path account.',
    otherDevices: 'Rise Path data left on your other devices is removed when Rise Path next opens there.',
    home: 'Go to the home page',
  },
  jp: {
    selfTitle: 'Rise Path のデータを削除しました',
    selfAt: (time: string) => `${time}に削除しました（日本時間）。この画面を保存しておくと、あとで確かめるときに役立ちます。`,
    selfBody:
      '学習の記録、作ったコース、ライフジャーナル、AI の記憶など、Rise Path のデータを削除し、この端末ではログアウトしました。元に戻せません。',
    login:
      'ログイン（メールアドレス、パスワード、登録したときの名前）は、Nexloom と P-School でも使うため残っています。同じメールアドレスでログインすると、空のアカウントから始まります。削除した直後は、1 分ほどたってからログインしてください。',
    otherTitle: 'この Rise Path のアカウントは削除されています',
    otherBody: 'この端末の記録を消して、ログアウトしました。',
    pschool: 'P-School を使うときも Rise Path にログインするため、そのときに空の Rise Path アカウントが作られます。',
    otherDevices: 'ほかの端末に残っている Rise Path のデータは、その端末で開いたときに消えます。',
    home: 'トップページへ',
  },
} as const;

type Lang = keyof typeof copy;

/** The deletion time in Japan time (dateStyle long, timeStyle short). */
export function formatDeletedAt(at: Date, language: Lang): string {
  return new Intl.DateTimeFormat(language === 'jp' ? 'ja-JP' : 'en-GB', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(at);
}

/** The page's text (exported for server/tests/accountDeletionFront.test.js). */
export const DeletedContent: React.FC<{
  language: Lang;
  by: DeletedBy;
  at: Date | null;
  titleId?: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
}> = ({ language, by, at, titleId, titleRef }) => {
  const t = copy[language];
  const self = by === 'self';
  return (
    <div className="mx-auto max-w-read px-4 pb-20 pt-8 sm:px-6">
      <header>
        <h1 ref={titleRef} id={titleId} tabIndex={-1} className="flex items-start gap-2 break-words text-h1 text-fg focus:outline-none">
          {self ? <CircleCheck size={28} aria-hidden="true" className="mt-1 shrink-0 text-success" /> : null}
          <span>{self ? t.selfTitle : t.otherTitle}</span>
        </h1>
      </header>
      <div className="mt-6 space-y-4 rounded-card border border-line bg-surface p-5 text-body-lg text-fg shadow-1 sm:p-6">
        {self && at ? <p className="font-semibold">{t.selfAt(formatDeletedAt(at, language))}</p> : null}
        <p>{self ? t.selfBody : t.otherBody}</p>
        <p className="text-body text-fg-2">{t.login}</p>
        <p className="text-body text-fg-2">{t.pschool}</p>
        {self ? <p className="text-body text-fg-2">{t.otherDevices}</p> : null}
        <SupportContact />
      </div>
      <div className="mt-6">
        <ButtonLink to="/" variant="secondary">
          {t.home}
        </ButtonLink>
      </div>
    </div>
  );
};

const AccountDeletedView: React.FC = () => {
  const { language } = useLanguage();
  const { isLoggedIn } = useAuth();
  const location = useLocation();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Read once: the page never changes its own address.
  const [{ by, at }] = useState(() => readDeletedPage(location.search));

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const content = <DeletedContent language={language} by={by} at={at} titleId={titleId} titleRef={titleRef} />;
  if (isLoggedIn) return content;
  return <PublicPageShell>{content}</PublicPageShell>;
};

export default AccountDeletedView;
