import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CircleAlert, CircleCheck, Clock, ExternalLink, Laptop, PlugZap, ShieldAlert, UserRound } from 'lucide-react';
import { useLanguage, type SelectedLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { features } from '../../../config/features';
import BrandMark from '../../common/BrandMark';
import { Button } from '../../ui/Button';
import { BirthYmFields } from '../../safety/BirthYmFields';
import type { AuthMode } from '../../common/ExperienceLoginView';
import {
  AI_SAFETY_PATH,
  AiAccessApiError,
  getAiAccess,
  isValidBirthYm,
  setBirthYm,
  toBirthYm,
  type AiAccessStatus,
} from '../../../services/aiAccessApi';
import {
  OAuthConsentError,
  approveConsent,
  authorizationIdFromSearch,
  browserStorage,
  claimsToBeRisePath,
  clearPendingAuthorization,
  consentEligibility,
  consentPathFor,
  denyConsent,
  getConsentRequest,
  isPendingFresh,
  pendingRemainingMs,
  readPendingAuthorization,
  savePendingAuthorization,
  type ConsentRequest,
  type RedirectInfo,
} from '../../../services/oauthConsentApi';

/**
 * /oauth/consent — a learner's own AI app (Claude Code, Codex, Claude.ai, ChatGPT, Cursor, …) asks
 * to connect to the Rise Path MCP endpoint (Phase 1, doc/brushup-2026/ai-access-plan.ja.md §5).
 * Supabase's OAuth 2.1 server sends the browser here with ?authorization_id=…
 *
 * Rendered outside the Layout, signed in or out. Signed out it offers sign-in and sign-up; the
 * request id is kept in localStorage for the 10 minutes Supabase keeps it, so App.tsx can come
 * back here after sign-in or email confirmation. Signed in it shows who asks, where the browser
 * returns, what the app can read and write, and where the data goes. Only an adult whose AI
 * access is ready can approve; everyone else gets Deny only. The MCP server checks the same rule
 * again on every request, because Supabase approves a repeat request without this page.
 *
 * The app's name, website and logo are chosen by whoever registered it: the name is labelled
 * unverified, the website is shown as text, and the logo is never loaded.
 */

type Lang = 'en' | 'jp';

const copy = {
  en: {
    skip: 'Skip to content',
    language: 'Language',
    home: 'Rise Path home',
    eyebrow: 'Connect an AI app',
    loading: 'Loading the request…',
    retry: 'Try again',
    unnamed: 'An app without a name',
    title: (name: string) => `${name} wants to connect to your Rise Path account`,
    signedOutTitle: 'An AI app wants to connect to your Rise Path account',
    signedOutBody: 'Sign in to see what the app asks for. You decide on the next screen; nothing is shared before that.',
    signIn: 'Sign in',
    signUp: 'Create an account',
    timeLeft: (min: number) => `This request is open for about ${min} more minute${min === 1 ? '' : 's'}.`,
    signUpHint:
      'If you create an account, open the confirmation email in this browser. We will bring you back here while the request is still open.',
    nameLabel: 'App name',
    nameUnverified: 'The app chose this name itself. Rise Path has not checked it.',
    impersonation:
      'This app calls itself Rise Path. Rise Path does not make AI apps that connect this way. Deny unless you set this up yourself.',
    websiteLabel: 'App website',
    returnLabel: 'After you decide, you go back to',
    redirect: {
      known: 'A well-known AI service.',
      web: 'Check that this is the AI service you are using. If you do not recognise it, deny.',
      insecure: 'This address is not encrypted (http). Deny unless you set this up yourself.',
      loopback:
        'A program on this computer, such as Claude Code, Codex or VS Code. Continue only if you started connecting from it just now.',
      app: 'An app installed on this device. Continue only if you started connecting from it just now.',
      missing: 'Supabase did not tell us the return address. Continue only if you started connecting just now.',
      invalid: 'The return address could not be read. We recommend denying.',
    } as Record<RedirectInfo['kind'], string>,
    signedInAs: 'Signed in as',
    switchAccount: 'Use another account',
    switchHint: 'The request stays with the account that opened it first. After switching, start connecting again from your AI app.',
    canTitle: 'What this app can do',
    readTitle: 'Read',
    readItems: [
      'The lessons of Rise Path courses, without the quiz answers',
      'Your progress in each lesson (sections read, quiz results) and your level for each subject',
      'Your recent learning journal entries (what you learned, difficulty, mood, confidence)',
      'Learning signals worked out from your journal (where it goes well, where you get stuck)',
      'Search the study materials you uploaded yourself',
      'The list of subjects and the tutor prompt for guided questions',
    ],
    writeTitle: 'Write',
    writeItems: [
      'Check your quiz answers. Each check is saved as your own attempt',
      'Mark the lesson sections you worked through as read',
      'Add an entry to your learning journal',
      'Record a finished lesson and its score in your progress',
    ],
    cannotTitle: 'What it cannot see',
    cannotItems: [
      'Your life journal and daily records',
      'What Rise Path’s AI remembers about you, and your personality profile',
      'Other learners’ data',
    ],
    dataTitle: 'Where your data goes',
    dataBody:
      'What the app reads from Rise Path is sent to the AI service you use with it (for example Anthropic or OpenAI), under your own agreement with that service. Rise Path cannot see, control or delete it there.',
    limitBody: 'Rise Path limits how often an app can read and write each day.',
    revokeBody:
      'You can disconnect the app at any time in Settings › Connected AI apps. Within a few seconds, it can no longer use your Rise Path data.',
    trustBody:
      'Allowing gives this app a sign-in for your Rise Path account. At the account service, that sign-in has the same power as your own, so allow only apps you trust.',
    safetyLink: 'About AI safety at Rise Path',
    termsLink: 'Terms of Use (in Japanese)',
    privacyLink: 'Privacy Policy (in Japanese)',
    newTab: '(opens in a new tab)',
    approve: 'Allow',
    deny: 'Deny',
    approving: 'Connecting…',
    denying: 'Denying…',
    decisionFailed: 'This could not be sent. Please try again.',
    adultOnly: 'Connecting your own AI app is for adults (18 and over).',
    minorBody:
      'Your account is set up for a learner under 18, so this app cannot connect. You can keep learning with the AI tutor inside Rise Path.',
    pausedHeading: 'AI is resting today.',
    pausedBody: 'AI is resting on your account for today, so this app cannot connect now. Please try again tomorrow.',
    unavailableHeading: 'We could not check your AI settings.',
    unavailableBody: 'We could not check your AI settings right now, so this app cannot connect. Please try again in a little while.',
    ageTitle: 'When were you born?',
    ageBody: 'Connecting an AI app is for adults. Enter your birth year and month first. We do not ask for the day.',
    ageOnce: 'You can enter this only once. If it is wrong, a staff member can fix it.',
    ageLegend: 'Year and month you were born',
    ageSave: 'Save',
    ageSaving: 'Saving…',
    ageInvalid: 'Please choose both the year and the month.',
    ageFailed: 'This could not be saved. Please try again in a little while.',
    expiredTitle: 'This request has expired',
    expiredBody:
      'Connection requests last 10 minutes. Go back to your AI app and start connecting again. It will open a new request here.',
    notFoundTitle: 'This request is no longer open',
    notFoundBody:
      'It may have expired, been answered already, or been opened with another account. Go back to your AI app and start connecting again.',
    noRequestTitle: 'There is no connection request here',
    noRequestBody: 'Start connecting from your AI app. It will open this page for you.',
    notConfiguredTitle: 'Connecting AI apps is not available yet',
    notConfiguredBody: 'This Rise Path server does not accept AI app connections. Please check again later.',
    sessionMismatch: 'Please sign in with your Rise Path account to answer this request.',
    loadFailed: 'We could not load this request. Please check your connection and try again.',
    toHome: 'Go to Rise Path',
    redirectingAllow: 'Connected. Taking you back to your AI app…',
    redirectingDeny: 'Denied. Taking you back to your AI app…',
    redirectingAlready: 'You already allowed this app. Taking you back to it…',
    closeHint: 'If nothing happens, you can close this tab and go back to your AI app.',
  },
  jp: {
    skip: '本文へ移動',
    language: '表示言語',
    home: 'Rise Path ホーム',
    eyebrow: 'AI アプリの接続',
    loading: 'リクエストを読み込んでいます…',
    retry: 'もう一度試す',
    unnamed: '名前のないアプリ',
    title: (name: string) => `${name} が Rise Path アカウントへの接続を求めています`,
    signedOutTitle: 'AI アプリが Rise Path アカウントへの接続を求めています',
    signedOutBody: 'サインインすると、アプリが何を求めているかを確認できます。決めるのは次の画面です。それまでは何も共有されません。',
    signIn: 'サインイン',
    signUp: 'アカウントを作る',
    timeLeft: (min: number) => `このリクエストは、あと約 ${min} 分有効です。`,
    signUpHint: 'アカウントを作る場合は、確認メールをこのブラウザで開いてください。リクエストが有効なうちは、この画面に戻ります。',
    nameLabel: 'アプリの名前',
    nameUnverified: 'この名前はアプリ自身が付けたものです。Rise Path は確認していません。',
    impersonation:
      'このアプリは Rise Path と名乗っています。Rise Path はこの方法でつなぐ AI アプリを作っていません。ご自身で設定したのでなければ、拒否してください。',
    websiteLabel: 'アプリのサイト',
    returnLabel: '決めたあとに戻る先',
    redirect: {
      known: 'よく知られた AI サービスです。',
      web: '使っている AI サービスか確認してください。心当たりがなければ、拒否してください。',
      insecure: '暗号化されていないアドレス（http）です。ご自身で設定したのでなければ、拒否してください。',
      loopback:
        'このパソコンで動いているプログラムです（Claude Code、Codex、VS Code など）。いま自分で接続を始めた場合だけ、続けてください。',
      app: 'この端末に入っているアプリです。いま自分で接続を始めた場合だけ、続けてください。',
      missing: '戻る先のアドレスが届いていません。いま自分で接続を始めた場合だけ、続けてください。',
      invalid: '戻る先のアドレスを読み取れませんでした。拒否をおすすめします。',
    } as Record<RedirectInfo['kind'], string>,
    signedInAs: 'サインイン中のアカウント',
    switchAccount: '別のアカウントを使う',
    switchHint: 'リクエストは最初に開いたアカウントにひもづきます。切り替えたあとは、AI アプリから接続をやり直してください。',
    canTitle: 'このアプリができること',
    readTitle: '読む',
    readItems: [
      'Rise Path のコースのレッスン（クイズの答えは除く）',
      'レッスンごとの進み具合（読んだセクション、クイズの結果）と、科目ごとのレベル',
      '最近の学習ジャーナル（学んだこと、難しさ、気分、自信）',
      'ジャーナルから求めた学習のシグナル（うまくいっているところ、つまずきやすいところ）',
      '自分でアップロードした教材の検索',
      '科目の一覧と、問いかけで導くチューター用のプロンプト',
    ],
    writeTitle: '書く',
    writeItems: [
      'クイズの答えを確かめる（確かめるたびに、あなた自身の解答として記録されます）',
      '取り組んだレッスンのセクションを、読み終えたと記録する',
      '学習ジャーナルに記録を追加する',
      '終えたレッスンとスコアを進み具合に記録する',
    ],
    cannotTitle: '見られないもの',
    cannotItems: ['ライフジャーナルや毎日の記録', 'Rise Path の AI が覚えていることや、性格のプロフィール', 'ほかの学習者のデータ'],
    dataTitle: 'データの行き先',
    dataBody:
      'アプリが Rise Path から読んだ内容は、そのアプリで使っている AI サービス（Anthropic や OpenAI など）に送られます。扱いは、あなたとそのサービスとの約束に従います。送られた先のデータを、Rise Path は見ることも、管理や削除をすることもできません。',
    limitBody: 'アプリが 1 日に読み書きできる回数には、Rise Path が上限を設けています。',
    revokeBody: '接続は、設定の「つないでいる AI アプリ」からいつでも解除できます。解除すると、数秒以内に Rise Path のデータを使えなくなります。',
    trustBody:
      '許可すると、このアプリは Rise Path アカウントのサインインを受け取ります。アカウントのサービスでは、あなた自身と同じ力で動けます。信頼できるアプリだけを許可してください。',
    safetyLink: 'Rise Path の AI の安全について',
    termsLink: '利用規約',
    privacyLink: 'プライバシーポリシー',
    newTab: '（新しいタブで開きます）',
    approve: '許可する',
    deny: '拒否する',
    approving: '接続しています…',
    denying: '拒否しています…',
    decisionFailed: '送信できませんでした。もう一度お試しください。',
    adultOnly: '自分の AI アプリをつなげるのは、18 歳以上の方です。',
    minorBody: 'このアカウントは 18 歳未満の学習者として設定されているため、このアプリはつなげません。Rise Path の中の AI チューターは、これまでどおり使えます。',
    pausedHeading: '今日は AI をお休みしています。',
    pausedBody: '今日はこのアカウントの AI をお休みしているため、いまはつなげません。明日もう一度お試しください。',
    unavailableHeading: 'AI の利用設定を確認できませんでした。',
    unavailableBody: 'いま AI の利用設定を確認できないため、このアプリはつなげません。少し時間をおいてお試しください。',
    ageTitle: '生まれた年と月を教えてください',
    ageBody: 'AI アプリをつなげるのは大人の方です。先に生まれた年と月を登録してください。日にちは聞きません。',
    ageOnce: '登録は一度だけです。まちがえたときは、スタッフが直せます。',
    ageLegend: '生まれた年と月',
    ageSave: '保存する',
    ageSaving: '保存しています…',
    ageInvalid: '年と月の両方を選んでください。',
    ageFailed: '保存できませんでした。少し時間をおいてお試しください。',
    expiredTitle: 'このリクエストは期限が切れました',
    expiredBody: '接続のリクエストは 10 分間有効です。AI アプリに戻って、接続をやり直してください。新しいリクエストがここに開きます。',
    notFoundTitle: 'このリクエストはもう使えません',
    notFoundBody:
      '期限が切れたか、すでに答えたか、別のアカウントで開かれた可能性があります。AI アプリに戻って、接続をやり直してください。',
    noRequestTitle: '接続のリクエストがありません',
    noRequestBody: 'AI アプリから接続を始めてください。アプリがこの画面を開きます。',
    notConfiguredTitle: 'AI アプリの接続は、まだ使えません',
    notConfiguredBody: 'この Rise Path サーバーは、AI アプリの接続を受け付けていません。またあとでご確認ください。',
    sessionMismatch: 'このリクエストに答えるには、Rise Path のアカウントでサインインしてください。',
    loadFailed: 'リクエストを読み込めませんでした。接続を確かめて、もう一度お試しください。',
    toHome: 'Rise Path へ',
    redirectingAllow: '接続しました。AI アプリに戻ります…',
    redirectingDeny: '拒否しました。AI アプリに戻ります…',
    redirectingAlready: 'このアプリはすでに許可されています。アプリに戻ります…',
    closeHint: '画面が変わらないときは、このタブを閉じて AI アプリに戻ってください。',
  },
} as const;

type T = (typeof copy)[Lang];

type Phase =
  | { kind: 'loading' }
  | { kind: 'no_request' }
  | { kind: 'expired' }
  | { kind: 'signed_out' }
  | { kind: 'session_mismatch' }
  | { kind: 'not_found' }
  | { kind: 'not_configured' }
  | { kind: 'error' }
  | { kind: 'ready'; request: ConsentRequest }
  | { kind: 'redirecting'; reason: 'allow' | 'deny' | 'already'; url: string };

const cardClasses = 'rounded-card border border-line bg-surface p-5 shadow-1 sm:p-6';

export interface OAuthConsentViewProps {
  /** Opens the sign-in or sign-up screen and returns to `returnTo` afterwards (App.tsx openAuth). */
  onSignIn: (mode: AuthMode, returnTo: string) => void;
}

const OAuthConsentView: React.FC<OAuthConsentViewProps> = ({ onSignIn }) => {
  const { language, selectedLanguage, setLanguage } = useLanguage();
  const { isLoggedIn, user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const t = copy[language];
  const languages: SelectedLanguage[] = features.frLocale ? ['en', 'jp', 'fr'] : ['en', 'jp'];

  const storage = useMemo(() => browserStorage(), []);
  // The id from the URL, else the one kept from before sign-in.
  const authorizationId = useMemo(() => {
    const fromUrl = authorizationIdFromSearch(location.search);
    if (fromUrl) return fromUrl;
    return readPendingAuthorization(storage)?.id ?? null;
  }, [location.search, storage]);

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [access, setAccess] = useState<AiAccessStatus | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  // Put the id back into the URL when it came from storage, so a reload keeps working.
  useEffect(() => {
    if (authorizationId && !authorizationIdFromSearch(location.search)) {
      navigate(consentPathFor(authorizationId), { replace: true });
    }
  }, [authorizationId, location.search, navigate]);

  const signedIn = isLoggedIn && !user?.isGuest;

  useEffect(() => {
    if (!authorizationId) {
      setPhase({ kind: 'no_request' });
      return;
    }
    const pending = savePendingAuthorization(storage, authorizationId);
    if (!isPendingFresh(pending)) {
      setPhase({ kind: 'expired' });
      return;
    }
    setRemainingMs(pendingRemainingMs(pending));
    if (!signedIn) {
      setPhase({ kind: 'signed_out' });
      return;
    }

    const controller = new AbortController();
    setPhase({ kind: 'loading' });
    void Promise.allSettled([getConsentRequest(authorizationId), getAiAccess(controller.signal)]).then(([details, status]) => {
      if (controller.signal.aborted) return;
      setAccess(status.status === 'fulfilled' ? status.value : null);
      if (details.status === 'rejected') {
        const kind = details.reason instanceof OAuthConsentError ? details.reason.kind : 'failed';
        if (kind === 'not_found') {
          clearPendingAuthorization(storage);
          setPhase({ kind: 'not_found' });
        } else if (kind === 'signed_out') setPhase({ kind: 'session_mismatch' });
        else if (kind === 'not_configured') setPhase({ kind: 'not_configured' });
        else setPhase({ kind: 'error' });
        return;
      }
      const value = details.value;
      if ('alreadyApproved' in value) {
        clearPendingAuthorization(storage);
        setPhase({ kind: 'redirecting', reason: 'already', url: value.redirectUrl });
        return;
      }
      setPhase({ kind: 'ready', request: value });
    });
    return () => controller.abort();
  }, [authorizationId, signedIn, storage, reloadKey]);

  // The request expires on Supabase's side after 10 minutes: show that instead of a dead form.
  useEffect(() => {
    if (!authorizationId || phase.kind === 'redirecting' || phase.kind === 'expired') return;
    if (phase.kind !== 'ready' && phase.kind !== 'signed_out' && phase.kind !== 'loading') return;
    const pending = readPendingAuthorization(storage);
    if (!pending || pending.id !== authorizationId) return;
    const tick = () => {
      const left = pendingRemainingMs(pending);
      setRemainingMs(left);
      if (left <= 0) setPhase({ kind: 'expired' });
    };
    const timer = window.setInterval(tick, 15_000);
    const deadline = window.setTimeout(tick, Math.max(0, pendingRemainingMs(pending)) + 50);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(deadline);
    };
  }, [authorizationId, phase.kind, storage]);

  // Leave for the agent once a decision is made.
  useEffect(() => {
    if (phase.kind !== 'redirecting') return;
    const timer = window.setTimeout(() => window.location.assign(phase.url), 400);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const decide = useCallback(
    async (action: 'allow' | 'deny') => {
      if (!authorizationId) return;
      const url = action === 'allow' ? await approveConsent(authorizationId) : await denyConsent(authorizationId);
      clearPendingAuthorization(storage);
      setPhase({ kind: 'redirecting', reason: action, url });
    },
    [authorizationId, storage],
  );

  const handleDecisionError = useCallback(
    (error: unknown) => {
      if (error instanceof OAuthConsentError && error.kind === 'not_found') {
        clearPendingAuthorization(storage);
        setPhase({ kind: 'not_found' });
        return true;
      }
      return false;
    },
    [storage],
  );

  const switchAccount = async () => {
    try {
      await logout();
    } catch {
      // Signed out locally anyway.
    }
    if (authorizationId) onSignIn('login', consentPathFor(authorizationId));
  };

  const minutesLeft = Math.max(1, Math.ceil(remainingMs / 60_000));

  let body: React.ReactNode;
  switch (phase.kind) {
    case 'loading':
      body = (
        <p role="status" className="text-body text-fg-3">
          {t.loading}
        </p>
      );
      break;
    case 'no_request':
      body = <Notice icon="info" title={t.noRequestTitle} body={t.noRequestBody} homeLabel={t.toHome} />;
      break;
    case 'expired':
      body = <Notice icon="clock" title={t.expiredTitle} body={t.expiredBody} homeLabel={t.toHome} />;
      break;
    case 'not_found':
      body = <Notice icon="alert" title={t.notFoundTitle} body={t.notFoundBody} homeLabel={t.toHome} />;
      break;
    case 'not_configured':
      body = <Notice icon="info" title={t.notConfiguredTitle} body={t.notConfiguredBody} homeLabel={t.toHome} />;
      break;
    case 'session_mismatch':
      body = (
        <section className={cardClasses} role="alert">
          <p className="flex items-start gap-2 text-body text-fg">
            <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            {t.sessionMismatch}
          </p>
          <Button className="mt-4" onClick={() => void switchAccount()}>
            {t.signIn}
          </Button>
        </section>
      );
      break;
    case 'error':
      body = (
        <section className={cardClasses} role="alert">
          <p className="flex items-start gap-2 text-body text-fg">
            <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            {t.loadFailed}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            {t.retry}
          </Button>
        </section>
      );
      break;
    case 'signed_out':
      body = (
        <SignedOut
          t={t}
          minutesLeft={minutesLeft}
          onSignIn={(mode) => authorizationId && onSignIn(mode, consentPathFor(authorizationId))}
        />
      );
      break;
    case 'redirecting':
      body = <Redirecting t={t} reason={phase.reason} />;
      break;
    case 'ready':
      body = (
        <ConsentCard
          t={t}
          request={phase.request}
          access={access}
          minutesLeft={minutesLeft}
          signedInEmail={phase.request.userEmail ?? user?.email ?? null}
          onAccessChange={setAccess}
          onRetryAccess={() => setReloadKey((k) => k + 1)}
          onDecide={decide}
          onDecisionError={handleDecisionError}
          onSwitchAccount={() => void switchAccount()}
        />
      );
      break;
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-fg">
      <a
        href="#oauth-consent-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-3"
      >
        {t.skip}
      </a>
      <header className="mx-auto flex max-w-form items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2.5 text-h3 font-bold text-fg">
          <BrandMark size={30} />
          <span>Rise Path</span>
        </span>
        <div role="group" aria-label={t.language} className="flex items-center gap-1 text-small">
          {languages.map((lang) => {
            const active = selectedLanguage === lang;
            return (
              <button
                key={lang}
                type="button"
                lang={lang === 'jp' ? 'ja' : lang}
                aria-pressed={active}
                onClick={() => setLanguage(lang)}
                className={`h-8 min-w-10 rounded-full px-2.5 font-semibold transition-colors duration-120 ${
                  active ? 'border border-line bg-surface text-fg shadow-1' : 'text-fg-3 hover:text-fg'
                }`}
              >
                {lang.toUpperCase()}
              </button>
            );
          })}
        </div>
      </header>
      <main id="oauth-consent-main" tabIndex={-1} className="mx-auto max-w-form px-4 pb-20 pt-2 focus:outline-none sm:px-6">
        <p className="flex items-center gap-2 text-small font-medium text-fg-3">
          <PlugZap size={16} aria-hidden="true" />
          {t.eyebrow}
        </p>
        <div className="mt-3 space-y-6">{body}</div>
      </main>
    </div>
  );
};

// --- pieces ----------------------------------------------------------------------------------------

const Notice: React.FC<{ icon: 'info' | 'clock' | 'alert'; title: string; body: string; homeLabel: string }> = ({
  icon,
  title,
  body,
  homeLabel,
}) => {
  const titleId = useId();
  const Icon = icon === 'clock' ? Clock : icon === 'alert' ? CircleAlert : PlugZap;
  return (
    <section aria-labelledby={titleId} className={cardClasses}>
      <h1 id={titleId} className="flex items-start gap-2 text-h2 text-fg">
        <Icon size={22} aria-hidden="true" className="mt-1 shrink-0 text-primary-text" />
        {title}
      </h1>
      <p className="mt-2 text-body text-fg-2">{body}</p>
      <p className="mt-4 text-body">
        <Link to="/" className="font-medium text-primary-text underline underline-offset-4">
          {homeLabel}
        </Link>
      </p>
    </section>
  );
};

const SignedOut: React.FC<{ t: T; minutesLeft: number; onSignIn: (mode: AuthMode) => void }> = ({ t, minutesLeft, onSignIn }) => {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cardClasses}>
      <h1 id={titleId} className="text-h1 text-fg">
        {t.signedOutTitle}
      </h1>
      <p className="mt-3 text-body text-fg-2">{t.signedOutBody}</p>
      <p className="mt-3 flex items-center gap-2 text-small text-fg-2">
        <Clock size={16} aria-hidden="true" className="shrink-0 text-fg-3" />
        {t.timeLeft(minutesLeft)}
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button onClick={() => onSignIn('login')}>{t.signIn}</Button>
        <Button variant="secondary" onClick={() => onSignIn('signup')}>
          {t.signUp}
        </Button>
      </div>
      <p className="mt-4 text-small text-fg-3">{t.signUpHint}</p>
    </section>
  );
};

const Redirecting: React.FC<{ t: T; reason: 'allow' | 'deny' | 'already' }> = ({ t, reason }) => (
  <section className={cardClasses}>
    <p role="status" className="flex items-start gap-2 text-body font-semibold text-fg">
      <CircleCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
      {reason === 'allow' ? t.redirectingAllow : reason === 'deny' ? t.redirectingDeny : t.redirectingAlready}
    </p>
    <p className="mt-2 text-small text-fg-2">{t.closeHint}</p>
  </section>
);

const ListBlock: React.FC<{ title: string; items: readonly string[] }> = ({ title, items }) => (
  <div>
    <h3 className="text-body font-semibold text-fg">{title}</h3>
    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-body text-fg-2 marker:text-fg-3">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </div>
);

const RedirectWarning: React.FC<{ t: T; redirect: RedirectInfo }> = ({ t, redirect }) => {
  const strong = redirect.kind === 'invalid' || redirect.kind === 'insecure';
  const caution = redirect.kind === 'web' || redirect.kind === 'missing' || redirect.kind === 'loopback' || redirect.kind === 'app';
  const Icon = redirect.kind === 'loopback' || redirect.kind === 'app' ? Laptop : strong ? ShieldAlert : redirect.kind === 'known' ? CircleCheck : CircleAlert;
  const tone = strong
    ? 'border-danger/40 bg-surface text-fg'
    : caution
      ? 'border-transparent bg-sun-soft text-fg'
      : 'border-line bg-sunken text-fg-2';
  return (
    <p className={`mt-2 flex items-start gap-2 rounded-control border px-3 py-2 text-small ${tone}`}>
      <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${strong ? 'text-danger' : caution ? 'text-sun-text' : 'text-success'}`} />
      <span>{t.redirect[redirect.kind]}</span>
    </p>
  );
};

type ConsentCardProps = {
  t: T;
  request: ConsentRequest;
  access: AiAccessStatus | null;
  minutesLeft: number;
  signedInEmail: string | null;
  onAccessChange: (next: AiAccessStatus) => void;
  onRetryAccess: () => void;
  onDecide: (action: 'allow' | 'deny') => Promise<void>;
  onDecisionError: (error: unknown) => boolean;
  onSwitchAccount: () => void;
};

const ConsentCard: React.FC<ConsentCardProps> = ({
  t,
  request,
  access,
  minutesLeft,
  signedInEmail,
  onAccessChange,
  onRetryAccess,
  onDecide,
  onDecisionError,
  onSwitchAccount,
}) => {
  const titleId = useId();
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eligibility = consentEligibility(access);
  // Saving the birth month moves the decision card (it sits before the details unless the
  // learner may allow): focus follows it, so the trust warning or the refusal is read next.
  const decisionRef = useRef<HTMLElement>(null);
  const focusDecision = useRef(false);
  const onAgeSaved = (next: AiAccessStatus) => {
    focusDecision.current = true;
    onAccessChange(next);
  };
  useEffect(() => {
    if (!focusDecision.current || eligibility === 'needs_age') return;
    focusDecision.current = false;
    decisionRef.current?.focus();
  }, [eligibility]);
  const name = request.client.name ?? t.unnamed;

  const run = async (action: 'allow' | 'deny') => {
    setBusy(action);
    setError(null);
    try {
      await onDecide(action);
    } catch (err) {
      if (!onDecisionError(err)) setError(t.decisionFailed);
      setBusy(null);
    }
  };

  // Approving is the last step; when it is not possible, say why first.
  const decisionCard = (
    <section ref={decisionRef} tabIndex={-1} className={`${cardClasses} focus:outline-none`}>
      {eligibility === 'needs_age' && <AgeForm t={t} onSaved={onAgeSaved} />}
      {eligibility === 'minor' && <Refusal heading={t.adultOnly} text={t.minorBody} />}
      {eligibility === 'paused' && <Refusal heading={t.pausedHeading} text={t.pausedBody} />}
      {eligibility === 'unavailable' && (
        <>
          <Refusal heading={t.unavailableHeading} text={t.unavailableBody} />
          <Button className="mt-3" variant="secondary" size="sm" onClick={onRetryAccess}>
            {t.retry}
          </Button>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-small text-danger">
          <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {eligibility === 'allowed' && (
        <p id={`${titleId}-trust`} className="mb-4 flex items-start gap-2 text-body font-medium text-fg">
          <ShieldAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-text" />
          {t.trustBody}
        </p>
      )}

      <div className={`flex flex-col-reverse gap-3 sm:flex-row sm:justify-end ${eligibility === 'allowed' ? '' : 'mt-5 border-t border-line pt-4'}`}>
        <Button variant="secondary" size="lg" disabled={busy !== null} onClick={() => void run('deny')}>
          {busy === 'deny' ? t.denying : t.deny}
        </Button>
        {eligibility === 'allowed' && (
          <Button size="lg" disabled={busy !== null} onClick={() => void run('allow')} aria-describedby={`${titleId}-trust`}>
            {busy === 'allow' ? t.approving : t.approve}
          </Button>
        )}
      </div>
      <p className="mt-3 flex items-center gap-2 text-caption text-fg-3 sm:justify-end">
        <Clock size={14} aria-hidden="true" className="shrink-0" />
        {t.timeLeft(minutesLeft)}
      </p>
    </section>
  );

  return (
    <>
      <section aria-labelledby={titleId} className={cardClasses}>
        <h1 id={titleId} className="break-words text-h1 text-fg">
          {t.title(name)}
        </h1>

        <dl className="mt-5 space-y-4 text-body">
          <div>
            <dt className="text-small font-medium text-fg-3">{t.nameLabel}</dt>
            <dd className="mt-0.5 break-words font-semibold text-fg">{name}</dd>
            <dd className="mt-0.5 text-small text-fg-2">{t.nameUnverified}</dd>
            {claimsToBeRisePath(request.client.name) && (
              <dd className="mt-2 flex items-start gap-2 rounded-control border border-danger/40 px-3 py-2 text-small text-fg">
                <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
                {t.impersonation}
              </dd>
            )}
          </div>
          {request.client.uriHost && (
            <div>
              <dt className="text-small font-medium text-fg-3">{t.websiteLabel}</dt>
              <dd className="mt-0.5 break-all font-mono text-fg">{request.client.uriHost}</dd>
            </div>
          )}
          <div>
            <dt className="text-small font-medium text-fg-3">{t.returnLabel}</dt>
            {request.redirect.host && <dd className="mt-0.5 break-all font-mono text-fg">{request.redirect.host}</dd>}
            <dd>
              <RedirectWarning t={t} redirect={request.redirect} />
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-center gap-2 text-small text-fg-2">
            <UserRound size={16} aria-hidden="true" className="shrink-0 text-fg-3" />
            <span className="shrink-0">{t.signedInAs}</span>
            <span className="min-w-0 truncate font-medium text-fg">{signedInEmail ?? '—'}</span>
          </p>
          <Button variant="ghost" size="sm" className="self-start sm:self-auto" onClick={onSwitchAccount} aria-describedby={`${titleId}-switch`}>
            {t.switchAccount}
          </Button>
        </div>
        <p id={`${titleId}-switch`} className="mt-1 text-caption text-fg-3">
          {t.switchHint}
        </p>
      </section>

      {eligibility !== 'allowed' && decisionCard}

      <section className={cardClasses} aria-labelledby={`${titleId}-can`}>
        <h2 id={`${titleId}-can`} className="text-h2 text-fg">
          {t.canTitle}
        </h2>
        <div className="mt-3 space-y-4">
          <ListBlock title={t.readTitle} items={t.readItems} />
          <ListBlock title={t.writeTitle} items={t.writeItems} />
          <ListBlock title={t.cannotTitle} items={t.cannotItems} />
        </div>
        <h2 className="mt-6 text-h2 text-fg">{t.dataTitle}</h2>
        <p className="mt-2 text-body text-fg-2">{t.dataBody}</p>
        <p className="mt-2 text-body text-fg-2">{t.limitBody}</p>
        <p className="mt-2 text-body text-fg-2">{t.revokeBody}</p>
        <p className="mt-3 text-body">
          <Link
            to={AI_SAFETY_PATH}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 font-medium text-primary-text underline underline-offset-4"
          >
            {t.safetyLink}
            <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only">{t.newTab}</span>
          </Link>
        </p>
        {/* Phase 4: the legal texts, once published (VITE_FEATURE_LEGAL_PAGES=true); a new tab keeps this page. */}
        {features.legalPages && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-body">
            {[
              { to: '/terms', label: t.termsLink },
              { to: '/privacy', label: t.privacyLink },
            ].map((page) => (
              <Link
                key={page.to}
                to={page.to}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 font-medium text-primary-text underline underline-offset-4"
              >
                {page.label}
                <ExternalLink size={14} aria-hidden="true" />
                <span className="sr-only">{t.newTab}</span>
              </Link>
            ))}
          </p>
        )}
      </section>

      {eligibility === 'allowed' && decisionCard}
    </>
  );
};

const Refusal: React.FC<{ heading: string; text: string }> = ({ heading, text }) => (
  <div>
    <p className="flex items-start gap-2 text-body font-semibold text-fg">
      <ShieldAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary-text" />
      {heading}
    </p>
    <p className="mt-2 text-body text-fg-2">{text}</p>
  </div>
);

const AgeForm: React.FC<{ t: T; onSaved: (next: AiAccessStatus) => void }> = ({ t, onSaved }) => {
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const titleId = useId();
  const mounted = useRef(true);
  // Set in the effect body: StrictMode (dev) runs mount, cleanup, mount, and a cleanup-only
  // effect would leave the flag false for good, so Save never finished.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ym = year && month ? toBirthYm(Number(year), Number(month)) : '';
    if (!ym || !isValidBirthYm(ym)) {
      setError(t.ageInvalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await setBirthYm(ym);
      if (mounted.current) onSaved(next);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof AiAccessApiError && err.errorType === 'age_already_set') {
        try {
          onSaved(await getAiAccess());
          return;
        } catch {
          // Fall through to the generic message.
        }
      }
      setError(err instanceof AiAccessApiError && err.errorType === 'invalid_birth_ym' ? t.ageInvalid : t.ageFailed);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div aria-labelledby={titleId} role="group">
      <h2 id={titleId} className="flex items-center gap-2 text-h2 text-fg">
        <UserRound size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
        {t.ageTitle}
      </h2>
      <p id={hintId} className="mt-2 text-body text-fg-2">
        {t.ageBody}
      </p>
      <form className="mt-4 space-y-4" onSubmit={submit} noValidate>
        <BirthYmFields
          legend={t.ageLegend}
          year={year}
          month={month}
          onYearChange={setYear}
          onMonthChange={setMonth}
          disabled={saving}
          describedBy={hintId}
        />
        <p className="text-small text-fg-2">{t.ageOnce}</p>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-small text-danger">
            <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={saving}>
          {saving ? t.ageSaving : t.ageSave}
        </Button>
      </form>
    </div>
  );
};

export default OAuthConsentView;
