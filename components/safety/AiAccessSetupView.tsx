import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleAlert, CircleCheck, CirclePause, Copy, ExternalLink, ShieldCheck, UserRound } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { BirthYmFields, selectClasses } from './BirthYmFields';
import { ConfirmDialog } from './ConfirmDialog';
import { SupportLines } from './SupportLines';
import { formatBirthYm, formatTokyoDateTime } from './format';
import {
  AI_SAFETY_PATH,
  AiAccessApiError,
  CONSENT_POLICY_VERSION,
  getAiAccess,
  giveGuardianConsent,
  isValidBirthYm,
  revokeGuardianConsent,
  setBirthYm,
  toBirthYm,
  type AiAccessStatus,
  type GuardianRelationship,
} from '../../services/aiAccessApi';

/**
 * /settings/ai-access — the learner's AI access (Phase 0.5 minor safeguards).
 *
 * Step 1: the learner (or a guardian or staff member with them) records the birth year and month.
 * Step 2, under 18 only: a guardian reads what the AI features do and agrees on this device.
 * Afterwards: the current state, and for a minor a way to withdraw the consent. A short user id is
 * shown so a staff member can record a paper consent form instead (admin page).
 *
 * The server decides everything (server/safety/access.js); this page only shows its answer.
 */

type Lang = 'en' | 'jp';

const copy = {
  en: {
    back: 'Back',
    eyebrow: 'Settings',
    title: 'AI access',
    description: 'Set up the AI tutor and the other AI features. Lessons without AI are always open.',
    loading: 'Loading…',
    retry: 'Try again',
    loadFailed: 'We could not load your AI settings right now. Please try again in a little while.',
    signInNeeded: 'Please sign in to set up AI.',
    signIn: 'Sign in',
    steps: 'Steps',
    step1: 'Birth year and month',
    step2: 'Guardian consent',
    done: 'done',
    current: 'current step',
    ageTitle: 'When were you born?',
    ageWhy:
      'We ask this to set up AI in a way that fits your age. If you are under 18, a parent or guardian agrees before you use AI. We do not ask for the day.',
    ageOnce: 'You can enter this only once. If it is wrong, tell a staff member or your guardian. They can fix it.',
    ageLegend: 'Year and month you were born',
    ageSave: 'Save',
    ageSaving: 'Saving…',
    ageInvalid: 'Please choose both the year and the month.',
    ageAlreadySet: 'Your birth month was already saved. We loaded the latest settings.',
    saveFailed: 'This could not be saved. Please try again in a little while.',
    stepDoneAge: (ym: string) => `Birth year and month: ${ym}`,
    consentHandOver: 'Please hand this screen to your parent or guardian.',
    consentTitle: 'For parents and guardians: consent to AI features',
    consentIntro:
      'This learner is under 18. Before they use the AI features, we ask a parent or guardian to read the points below and agree.',
    whatTitle: 'What the AI features do',
    whatItems: [
      'AI tutor: answers questions about the lesson being read.',
      'Writing feedback: comments on what the learner wrote and suggests improvements.',
      'Assessment insight: explains the result of the learning-style check in words.',
      'Course builder: drafts a study course from what the learner wants to learn.',
    ],
    whatNote: 'AI answers can be wrong. Please remind your child to check important things with other sources or an adult.',
    dataTitle: 'What data is sent',
    dataItems: [
      'What your child types into an AI feature (questions, writing) and the related lesson text are sent to Anthropic (a company in the USA), which provides the AI, to create the answer and, for learners under 18, to check it.',
      'Names and email addresses are not sent. Only a code derived from the account, which cannot be turned back into it, is sent to tell users apart.',
      'Under Anthropic’s commercial terms, what is sent is not used to train their AI models.',
    ],
    protectTitle: 'How we protect children',
    protectItems: [
      'The AI receives extra child-safety instructions.',
      'Your child’s messages and the AI’s answers are checked before they are shown. Unsuitable content is stopped.',
      'When a message shows distress, the screen shows places where children can talk to someone.',
      'If many messages are stopped in one day, AI pauses until the next day.',
      'Anyone can report a strange answer with the “Report” button; our staff review the reports.',
    ],
    keepTitle: 'What we record',
    keepItems: [
      'Birth year and month; the date, relationship and method of this consent. We do not record the guardian’s name.',
      'Records of stopped messages (without the text) are kept for one year. The text of a report is kept for 90 days, then deleted.',
    ],
    revokeTitle: 'How to withdraw consent',
    revokeBody:
      'You can withdraw it on this page at any time, or ask a staff member. AI stops at once; lessons without AI stay open.',
    moreLink: 'Read more about AI safety',
    newTab: '(opens in a new tab)',
    relationship: 'Your relationship to the learner',
    relationshipChoose: 'Choose',
    relationships: { parent: 'Parent', guardian: 'Guardian (not a parent, e.g. grandparent or legal guardian)', other: 'Other caregiver' },
    agree: 'I am this learner’s parent or guardian. I have read the points above and agree that they use the AI features.',
    consentButton: 'Agree and turn on AI',
    consentSaving: 'Saving…',
    consentIncomplete: 'Please choose the relationship and tick the box.',
    policyChanged: 'The consent text has been updated. Please reload this page and read it again.',
    policyVersion: (v: string) => `Consent text version: ${v}`,
    paperHint: 'Using a paper consent form instead? Show the number at the bottom of this page to a staff member.',
    readyTitle: 'You can use AI',
    readyAdult: 'AI answers are marked as written by AI. If an answer seems wrong or strange, you can report it.',
    readyMinor: 'Your guardian has agreed. AI answers are checked before you see them. If something seems strange, press “Report”.',
    birthMonth: 'Birth year and month',
    consentGiven: 'Guardian consent',
    methodDevice: 'given on this device',
    methodPaper: 'paper form recorded by staff',
    revokeButton: 'Withdraw guardian consent',
    revokeDialogTitle: 'Withdraw the consent?',
    revokeDialogBody: 'AI stops right away. Lessons without AI stay open. To use AI again, a guardian agrees again.',
    revokeConfirm: 'Withdraw',
    cancel: 'Cancel',
    revoked: 'The consent was withdrawn. AI is off now.',
    pausedTitle: 'AI is resting for today',
    pausedBody: (time: string | null) =>
      `Some messages today could not be sent to the AI, so AI is resting for now. ${time ? `You can use it again from ${time}.` : 'You can use it again tomorrow.'} You did not do anything bad by asking.`,
    pausedTalk: 'If something is worrying you, the places below will listen.',
    staffTitle: 'Number for staff',
    staffBody: 'Show this to a staff member when they record a paper consent form or your birth month for you.',
    copy: 'Copy the full number',
    copied: 'Copied',
    fullId: 'Full number',
  },
  jp: {
    back: '戻る',
    eyebrow: '設定',
    title: 'AI の利用設定',
    description: 'AI 先生などの AI 機能を使うための設定です。AI を使わない学習は、いつでも続けられます。',
    loading: '読み込んでいます…',
    retry: 'もう一度読み込む',
    loadFailed: '今は設定を読み込めませんでした。少し待ってから、もう一度お試しください。',
    signInNeeded: 'AI の設定をするには、ログインしてください。',
    signIn: 'ログインする',
    steps: '手順',
    step1: '生まれた年と月',
    step2: '保護者の同意',
    done: 'おわり',
    current: 'いまの手順',
    ageTitle: '生まれた年と月を教えてください',
    ageWhy:
      '年れいに合ったやり方で AI を使うためです。18歳未満の人は、AI を使う前に保護者の人の同意が必要です。生まれた日は聞きません。',
    ageOnce: '登録は1回だけです。まちがえたときは、スタッフか保護者の人に伝えてください。直してもらえます。',
    ageLegend: '生まれた年と月',
    ageSave: '登録する',
    ageSaving: '登録しています…',
    ageInvalid: '年と月を、どちらも選んでください。',
    ageAlreadySet: '生まれた年と月は、もう登録されていました。新しい設定を読み込みました。',
    saveFailed: '今は登録できませんでした。少し待ってから、もう一度お試しください。',
    stepDoneAge: (ym: string) => `生まれた年と月：${ym}`,
    consentHandOver: 'ここからは、保護者の方に画面を見せてください。',
    consentTitle: '保護者の方へ：AI 機能を使うことへの同意',
    consentIntro:
      'このお子さまは18歳未満です。AI 機能を使う前に、保護者の方に次の内容を読んでいただき、同意をお願いしています。',
    whatTitle: 'AI 機能でできること',
    whatItems: [
      'AI 先生：読んでいるレッスンについて、質問に答えます。',
      '作文フィードバック：書いた文章に、感想と直し方を返します。',
      '診断の解説：学び方の診断の結果を、文章で説明します。',
      'コースづくり：学びたいことから、学習コースの案をつくります。',
    ],
    whatNote: 'AI の答えは、まちがえることがあります。大事なことはほかの資料や大人に確かめるよう、お子さまにお伝えください。',
    dataTitle: '送られるデータ',
    dataItems: [
      'お子さまが AI 機能に入力した文章（質問や作文など）と、関係するレッスンの文章を、AI の提供元である Anthropic 社（アメリカ）に送り、答えをつくります。18歳未満の方は、答えを確かめるためにも送ります。',
      '名前やメールアドレスは送りません。利用者を区別するため、アカウントからつくった、元に戻せない記号だけを送ります。',
      'Anthropic 社の商用利用規約により、送った内容は AI の学習（トレーニング）には使われません。',
    ],
    protectTitle: 'お子さまを守るしくみ',
    protectItems: [
      'AI に、子どもの安全のための指示を加えています。',
      'お子さまの入力と AI の答えを、表示する前に確かめます。ふさわしくない内容は止めます。',
      'つらい気持ちが書かれたときは、相談できる窓口を表示します。',
      '止められる入力が1日に何度も続いたときは、その日の AI をお休みにします。',
      'おかしな答えは「報告」ボタンで知らせることができ、運営スタッフが確認します。',
    ],
    keepTitle: '記録すること',
    keepItems: [
      '生まれた年と月、この同意の日時・続柄・方法を記録します。保護者の方のお名前は記録しません。',
      '止めた入力の記録（文章はふくみません）は1年間、報告の文章は90日間保管し、その後消します。',
    ],
    revokeTitle: '同意のやめ方',
    revokeBody:
      'この画面から、いつでも同意をやめられます。スタッフに伝えていただいても止められます。やめると AI はすぐに止まり、AI を使わない学習は続けられます。',
    moreLink: 'AI の安全についてくわしく読む',
    newTab: '（新しいタブで開きます）',
    relationship: 'お子さまとの関係',
    relationshipChoose: '選んでください',
    relationships: { parent: '親（父・母）', guardian: '親以外の保護者（祖父母、後見人など）', other: 'その他の養育者' },
    agree: '私はこのお子さまの保護者です。上の内容を読み、お子さまが AI 機能を使うことに同意します。',
    consentButton: '同意して AI を使えるようにする',
    consentSaving: '記録しています…',
    consentIncomplete: '関係を選び、同意のチェックを入れてください。',
    policyChanged: '同意の文が新しくなりました。ページを読み込み直して、もう一度お読みください。',
    policyVersion: (v: string) => `同意文の版：${v}`,
    paperHint: '紙の同意書を使う場合は、このページのいちばん下の番号をスタッフに見せてください。',
    readyTitle: 'AI を使えます',
    readyAdult: 'AI の答えには「AI が作った答え」と表示されます。おかしな答えは「報告」で知らせることができます。',
    readyMinor: '保護者の人が同意しています。AI の答えは、表示する前に確かめています。おかしいと思ったら「報告」をおしてください。',
    birthMonth: '生まれた年と月',
    consentGiven: '保護者の同意',
    methodDevice: 'この端末で同意',
    methodPaper: '紙の同意書（スタッフが記録）',
    revokeButton: '保護者の同意をやめる',
    revokeDialogTitle: '同意をやめますか？',
    revokeDialogBody: 'AI はすぐに使えなくなります。AI を使わない学習は続けられます。また使うときは、保護者の人にもう一度同意してもらいます。',
    revokeConfirm: '同意をやめる',
    cancel: 'やめない',
    revoked: '同意をやめました。いまは AI を使えません。',
    pausedTitle: '今日は AI をお休みしています',
    pausedBody: (time: string | null) =>
      `今日は AI に送れない内容が何回かあったので、AI をお休みしています。${time ? `${time}から、また使えます。` : '明日になると、また使えます。'}質問したことを、責めているのではありません。`,
    pausedTalk: '気になっていることがあれば、下の窓口で話を聞いてもらえます。',
    staffTitle: 'スタッフに見せる番号',
    staffBody: '紙の同意書や生まれた年と月を、スタッフに登録してもらうときに見せてください。',
    copy: '番号をぜんぶコピー',
    copied: 'コピーしました',
    fullId: 'ぜんぶの番号',
  },
} as const;

const RELATIONSHIPS: GuardianRelationship[] = ['parent', 'guardian', 'other'];

const cardClasses = 'rounded-card border border-line bg-surface p-5 shadow-1';

const AiAccessSetupView: React.FC = () => {
  const { language } = useLanguage();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const t = copy[language];

  const [access, setAccess] = useState<AiAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'failed' | 'signin' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getAiAccess(signal);
      if (!signal?.aborted) setAccess(next);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof AiAccessApiError && error.status === 401 ? 'signin' : 'failed');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/settings');
  };

  const showSteps = access && (access.status === 'needs_age' || access.status === 'needs_guardian_consent');
  // Move focus to step 2 only when it appears after step 1 was saved, not on page load.
  const [advanced, setAdvanced] = useState(false);

  return (
    <div className="mx-auto max-w-form px-4 pb-20 pt-8 sm:px-6">
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-2 rounded-control text-small font-medium text-fg-2 hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {t.back}
      </button>

      <PageHeader className="mt-4" eyebrow={t.eyebrow} title={t.title} description={t.description} />

      <div className="mt-6 space-y-6">
        {notice && (
          <p role="status" className="flex items-start gap-2 rounded-control border border-line bg-sunken px-4 py-3 text-body text-fg">
            <CircleCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
            {notice}
          </p>
        )}

        {loading && !access ? (
          <p role="status" className="text-body text-fg-3">
            {t.loading}
          </p>
        ) : loadError && !access ? (
          <div role="alert" className={cardClasses}>
            <p className="flex items-start gap-2 text-body text-fg">
              <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
              {loadError === 'signin' ? t.signInNeeded : t.loadFailed}
            </p>
            {loadError === 'failed' && (
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => void load()}>
                {t.retry}
              </Button>
            )}
            {loadError === 'signin' && (
              // Signing out of the guest session leads to the sign-in page.
              <Button className="mt-3" size="sm" onClick={() => void logout({ reason: 'reauth' })}>
                {t.signIn}
              </Button>
            )}
          </div>
        ) : access ? (
          <>
            {showSteps && <Steps status={access.status} t={t} />}

            {access.status === 'needs_age' && (
              <AgeStep
                t={t}
                onSaved={(next) => {
                  setNotice(null);
                  setAdvanced(true);
                  setAccess(next);
                }}
                onAlreadySet={() => {
                  setNotice(t.ageAlreadySet);
                  setAdvanced(true);
                  void load();
                }}
              />
            )}

            {access.status === 'needs_guardian_consent' && (
              <ConsentStep
                t={t}
                language={language}
                birthYm={access.birthYm}
                autoFocus={advanced}
                onSaved={(next) => {
                  setNotice(null);
                  setAdvanced(true);
                  setAccess(next);
                }}
              />
            )}

            {access.status === 'ready' && (
              <ReadyCard
                t={t}
                language={language}
                access={access}
                autoFocus={advanced}
                onRevoked={(next) => {
                  // The card and its revoke button unmount: let the consent step take focus.
                  setAdvanced(true);
                  setAccess(next);
                  setNotice(t.revoked);
                }}
              />
            )}

            {access.status === 'paused' && (
              <PausedCard
                t={t}
                language={language}
                access={access}
                autoFocus={advanced}
                onRevoked={(next) => {
                  // The card and its revoke button unmount: let the consent step take focus.
                  setAdvanced(true);
                  setAccess(next);
                  setNotice(t.revoked);
                }}
              />
            )}
          </>
        ) : null}

        {user && !user.isGuest && <StaffIdCard t={t} userId={user.id} />}

        <p className="text-small text-fg-2">
          <Link to={AI_SAFETY_PATH} className="font-medium text-primary-text underline underline-offset-4">
            {t.moreLink}
          </Link>
        </p>
      </div>
    </div>
  );
};

type T = (typeof copy)[Lang];

const Steps: React.FC<{ status: AiAccessStatus['status']; t: T }> = ({ status, t }) => {
  const items = [
    { key: 'age', label: t.step1, done: status !== 'needs_age', current: status === 'needs_age' },
    { key: 'consent', label: t.step2, done: false, current: status === 'needs_guardian_consent' },
  ];
  return (
    <nav aria-label={t.steps}>
      <ol className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <li
            key={item.key}
            aria-current={item.current ? 'step' : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-small ${
              item.current ? 'border-primary bg-primary-soft font-semibold text-primary-text' : 'border-line bg-surface text-fg-2'
            }`}
          >
            {item.done ? (
              <CircleCheck size={16} aria-hidden="true" className="text-success" />
            ) : (
              <span aria-hidden="true" className="tabular">
                {index + 1}
              </span>
            )}
            {item.label}
            {item.done && <span className="sr-only">（{t.done}）</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
};

/** Moves focus to a step's heading when it appears (after the previous step was saved). */
function useFocusOnMount<E extends HTMLElement>(enabled: boolean) {
  const ref = useRef<E>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

const AgeStep: React.FC<{ t: T; onSaved: (next: AiAccessStatus) => void; onAlreadySet: () => void }> = ({ t, onSaved, onAlreadySet }) => {
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const titleId = useId();

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
      onSaved(await setBirthYm(ym));
    } catch (err) {
      if (err instanceof AiAccessApiError && err.errorType === 'age_already_set') onAlreadySet();
      else if (err instanceof AiAccessApiError && err.errorType === 'invalid_birth_ym') setError(t.ageInvalid);
      else setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={titleId} className={cardClasses}>
      <h2 id={titleId} className="flex items-center gap-2 text-h2 text-fg">
        <UserRound size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
        {t.ageTitle}
      </h2>
      <p id={hintId} className="mt-2 text-body text-fg-2">
        {t.ageWhy}
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
        <Button type="submit" disabled={saving}>
          {saving ? t.ageSaving : t.ageSave}
        </Button>
      </form>
    </section>
  );
};

const ListBlock: React.FC<{ title: string; items: readonly string[]; note?: string }> = ({ title, items, note }) => (
  <div>
    <h3 className="text-h3 text-fg">{title}</h3>
    <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-fg-2 marker:text-fg-3">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
    {note ? <p className="mt-2 text-body text-fg">{note}</p> : null}
  </div>
);

const ConsentStep: React.FC<{
  t: T;
  language: Lang;
  birthYm: string | null;
  autoFocus: boolean;
  onSaved: (next: AiAccessStatus) => void;
}> = ({ t, language, birthYm, autoFocus, onSaved }) => {
  const [relationship, setRelationship] = useState<GuardianRelationship | ''>('');
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useFocusOnMount<HTMLHeadingElement>(autoFocus);
  const titleId = useId();
  const relationshipId = useId();
  const agreeId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!relationship || !agreed) {
      setError(t.consentIncomplete);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await giveGuardianConsent({ relationship }));
    } catch (err) {
      if (err instanceof AiAccessApiError && err.errorType === 'policy_version_mismatch') setError(t.policyChanged);
      else setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="flex items-center gap-2 text-small text-fg-2">
        <CircleCheck size={16} aria-hidden="true" className="shrink-0 text-success" />
        {t.stepDoneAge(formatBirthYm(birthYm, language))}
      </p>

      <section aria-labelledby={titleId} className={cardClasses}>
        <p className="rounded-control bg-sunken px-3 py-2 text-body font-semibold text-fg">{t.consentHandOver}</p>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="mt-4 flex items-start gap-2 text-h2 text-fg">
          <ShieldCheck size={22} aria-hidden="true" className="mt-1 shrink-0 text-primary-text" />
          {t.consentTitle}
        </h2>
        <p className="mt-2 text-body text-fg-2">{t.consentIntro}</p>

        <div className="mt-5 space-y-5">
          <ListBlock title={t.whatTitle} items={t.whatItems} note={t.whatNote} />
          <ListBlock title={t.dataTitle} items={t.dataItems} />
          <ListBlock title={t.protectTitle} items={t.protectItems} />
          <ListBlock title={t.keepTitle} items={t.keepItems} />
          <div>
            <h3 className="text-h3 text-fg">{t.revokeTitle}</h3>
            <p className="mt-2 text-body text-fg-2">{t.revokeBody}</p>
          </div>
          <p className="text-body">
            <Link
              to={AI_SAFETY_PATH}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 font-medium text-primary-text underline underline-offset-4"
            >
              {t.moreLink}
              <ExternalLink size={14} aria-hidden="true" />
              <span className="sr-only">{t.newTab}</span>
            </Link>
          </p>
        </div>

        <form className="mt-6 space-y-4 border-t border-line pt-5" onSubmit={submit} noValidate>
          <div>
            <label htmlFor={relationshipId} className="block text-body font-semibold text-fg">
              {t.relationship}
            </label>
            <select
              id={relationshipId}
              value={relationship}
              disabled={saving}
              onChange={(e) => setRelationship(e.target.value as GuardianRelationship | '')}
              className={`mt-2 sm:max-w-sm ${selectClasses}`}
            >
              <option value="">{t.relationshipChoose}</option>
              {RELATIONSHIPS.map((key) => (
                <option key={key} value={key}>
                  {t.relationships[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-start gap-3">
            <input
              id={agreeId}
              type="checkbox"
              checked={agreed}
              disabled={saving}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <label htmlFor={agreeId} className="text-body text-fg">
              {t.agree}
            </label>
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 text-small text-danger">
              <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" disabled={saving} fullWidth className="sm:w-auto">
            {saving ? t.consentSaving : t.consentButton}
          </Button>
          <p className="text-small text-fg-3">{t.policyVersion(CONSENT_POLICY_VERSION)}</p>
          <p className="text-small text-fg-2">{t.paperHint}</p>
        </form>
      </section>
    </>
  );
};

type CardProps = {
  t: T;
  language: Lang;
  access: AiAccessStatus;
  /** Focus the heading when the card appears after a save (the form that had focus is gone). */
  autoFocus: boolean;
  onRevoked: (next: AiAccessStatus) => void;
};

/** The birth month and, for a minor, the consent on record. */
const AccessSummary: React.FC<{ t: T; language: Lang; access: AiAccessStatus }> = ({ t, language, access }) => {
  const minor = access.audience === 'minor';
  const consent = access.consent;
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-2 text-body sm:grid-cols-[auto_1fr]">
      {access.birthYm && (
        <>
          <dt className="font-medium text-fg-2">{t.birthMonth}</dt>
          <dd className="text-fg">{formatBirthYm(access.birthYm, language)}</dd>
        </>
      )}
      {minor && consent && (
        <>
          <dt className="font-medium text-fg-2">{t.consentGiven}</dt>
          <dd className="text-fg">
            {formatTokyoDateTime(consent.givenAt, language)}
            {' · '}
            {consent.method === 'staff_paper_form' ? t.methodPaper : t.methodDevice}
            {consent.relationship ? ` · ${t.relationships[consent.relationship]}` : ''}
          </dd>
        </>
      )}
    </dl>
  );
};

/** The guardian's way to withdraw consent (a minor with consent), in the ready and paused states. */
const RevokeConsent: React.FC<{ t: T; onRevoked: (next: AiAccessStatus) => void }> = ({ t, onRevoked }) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await revokeGuardianConsent();
      setConfirmOpen(false);
      onRevoked(next);
    } catch {
      setConfirmOpen(false);
      setError(t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-small text-danger">
          <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <Button ref={revokeRef} className="mt-5" variant="secondary" onClick={() => setConfirmOpen(true)}>
        {t.revokeButton}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title={t.revokeDialogTitle}
        body={t.revokeDialogBody}
        confirmLabel={t.revokeConfirm}
        cancelLabel={t.cancel}
        busy={busy}
        onConfirm={() => void revoke()}
        onClose={() => setConfirmOpen(false)}
        returnFocusRef={revokeRef}
      />
    </>
  );
};

const ReadyCard: React.FC<CardProps> = ({ t, language, access, autoFocus, onRevoked }) => {
  const titleId = useId();
  const headingRef = useFocusOnMount<HTMLHeadingElement>(autoFocus);
  const minor = access.audience === 'minor';

  return (
    <section aria-labelledby={titleId} className={cardClasses}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-h2 text-fg">
        <CircleCheck size={22} aria-hidden="true" className="shrink-0 text-success" />
        {t.readyTitle}
      </h2>
      <p className="mt-2 text-body text-fg-2">{minor ? t.readyMinor : t.readyAdult}</p>
      <AccessSummary t={t} language={language} access={access} />
      {minor && access.consent && <RevokeConsent t={t} onRevoked={onRevoked} />}
    </section>
  );
};

const PausedCard: React.FC<CardProps> = ({ t, language, access, autoFocus, onRevoked }) => {
  const titleId = useId();
  const headingRef = useFocusOnMount<HTMLHeadingElement>(autoFocus);
  const until = formatTokyoDateTime(access.pausedUntil, language, true);
  const minor = access.audience === 'minor';
  return (
    <section aria-labelledby={titleId} className={`${cardClasses} space-y-4`}>
      <div>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-h2 text-fg">
          <CirclePause size={22} aria-hidden="true" className="shrink-0 text-info" />
          {t.pausedTitle}
        </h2>
        <p className="mt-2 text-body text-fg-2">{t.pausedBody(until)}</p>
        <p className="mt-2 text-body text-fg-2">{t.pausedTalk}</p>
      </div>
      <SupportLines compact />
      {minor && access.consent && (
        <div>
          <AccessSummary t={t} language={language} access={access} />
          <RevokeConsent t={t} onRevoked={onRevoked} />
        </div>
      )}
    </section>
  );
};

const StaffIdCard: React.FC<{ t: T; userId: string }> = ({ t, userId }) => {
  const [copied, setCopied] = useState(false);
  const titleId = useId();
  const shortId = userId.slice(0, 8);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby={titleId} className="rounded-card border border-line bg-sunken p-4">
      <h2 id={titleId} className="text-body font-semibold text-fg">
        {t.staffTitle}
      </h2>
      <p className="mt-1 text-small text-fg-2">{t.staffBody}</p>
      <p className="mt-3 font-mono text-h2 text-fg tabular">
        {shortId}
      </p>
      <p className="mt-1 break-all text-small text-fg-2">
        <span className="font-medium">{t.fullId}: </span>
        <span className="font-mono">{userId}</span>
      </p>
      <Button className="mt-3" variant="secondary" size="sm" leadingIcon={<Copy size={14} aria-hidden="true" />} onClick={() => void copyId()}>
        {copied ? t.copied : t.copy}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t.copied : ''}
      </span>
    </section>
  );
};

export default AiAccessSetupView;
