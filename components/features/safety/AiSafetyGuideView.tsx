import React from 'react';
import { Link } from 'react-router-dom';
import { Bot, ExternalLink, Flag, Scale, ShieldCheck, Smile } from 'lucide-react';
import { useLanguage, type SelectedLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { features } from '../../../config/features';
import BrandMark from '../../common/BrandMark';
import PageHeader from '../../ui/PageHeader';
import { ButtonLink } from '../../ui/Button';
import { SupportLines } from '../../safety/SupportLines';
import { AI_ACCESS_SETUP_PATH, CONSENT_POLICY_VERSION } from '../../../services/aiAccessApi';

/**
 * /ai-safety — public guide to the AI features (Phase 0.5, doc/brushup-2026/ai-access-plan.ja.md §4):
 * a part for children in plain Japanese, a part for guardians, places to talk to, how reports work,
 * and the compliance statement. Open when signed out (App.tsx renders it outside the Layout then).
 *
 * Keep every statement true to the code: server/safety/* (age, consent, screening, pause),
 * server/routes/safety.js (reports), server/safety/events.js (retention), context/AuthContext.tsx
 * (logout clears AI answers kept in this browser), DeleteAccountView.tsx (the delete page; the
 * server can turn deletion off, so the line only says where to go). No invented facts.
 */

const LINKS = {
  ppc: 'https://www.ppc.go.jp/all_faq_index/faq1-q1-62/',
  minors: 'https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors',
  aup: 'https://www.anthropic.com/legal/aup',
} as const;

type Para = string;

const copy = {
  en: {
    skip: 'Skip to content',
    language: 'Language',
    home: 'Rise Path home',
    eyebrow: 'Updated 22 October 2026',
    title: 'AI safety at Rise Path',
    description: 'How the AI features work, how we protect children, and what guardians can do.',
    toc: 'On this page',
    newTab: '(opens in a new tab)',
    setup: 'Open AI access settings',
    backHome: 'Back to the home page',
    kids: {
      title: 'For children',
      items: [
        'AI is not a person. It is a computer program.',
        'AI answers can be wrong. If something looks strange, ask a teacher or someone at home.',
        'Do not write your name, address, phone number, school name or photos, or other people’s, to the AI.',
        'Some messages cannot be sent to the AI and stop part way. That does not mean you did something bad.',
        'If an answer is strange or makes you feel bad, press “Report” under the answer. Our staff will look at it.',
        'If something is hard or scary, you do not have to keep it to yourself. Talk to someone at home, a teacher, or one of the places below.',
        'If you are under 18, a parent or guardian agrees before you use AI.',
      ] as Para[],
    },
    guardians: {
      title: 'For parents and guardians',
      featuresTitle: 'The AI features',
      featuresItems: [
        'AI tutor: answers questions about the lesson being read.',
        'Writing feedback: comments on what the learner wrote and suggests improvements.',
        'Assessment insight: explains the result of the learning-style check in words.',
        'Course builder: drafts a study course from what the learner wants to learn.',
      ] as Para[],
      featuresNote:
        'The AI features use Claude, an AI made by Anthropic. Answers written by AI are marked as such on screen. AI answers can be wrong; please encourage your child to check important things.',
      ageTitle: 'Age and consent',
      age: [
        'Before using AI, each learner records the year and month they were born (we do not ask for the day).',
        'Learners under 18 cannot use the AI features until a parent or guardian’s consent is recorded. A guardian agrees on the learner’s device, or a staff member records a paper consent form.',
        'Lessons without AI are open without consent.',
      ] as Para[],
      dataTitle: 'What data is sent',
      data: [
        'What a learner types into an AI feature (questions, writing) and the related lesson text are sent to Anthropic (a company in the USA) to create the answer and, for learners under 18, to check it.',
        'Names and email addresses are not sent. Only a code derived from the account, which cannot be turned back into it, is sent to tell users apart.',
        'Under Anthropic’s commercial terms, what is sent is not used to train their AI models.',
      ] as Para[],
      protectTitle: 'How we protect children',
      protect: [
        'The AI receives extra child-safety instructions for learners under 18.',
        'For learners under 18, messages and AI answers are checked before they are shown. Unsuitable content is stopped. If the check cannot run, the answer is not shown.',
        'When a message shows distress, the screen shows places where children can talk to someone.',
        'If many messages are stopped in one day, AI pauses until midnight (Japan time).',
        'On a shared device, signing out removes the AI answers kept in that browser (cards you made from the tutor\'s answers, assessment results and drafts).',
      ] as Para[],
      revokeTitle: 'Withdrawing consent',
      revoke:
        'In Settings → AI access, a guardian can withdraw consent at any time, or ask a staff member. AI stops at once; lessons without AI stay open.',
      version: (v: string) => `Current consent text version: ${v}`,
    },
    support: { title: 'Places to talk to' },
    reports: {
      title: 'How reports work',
      items: [
        'Below an AI answer, the “Report” button sends the answer with a reason: harmful, wrong, not right for my age, or other.',
        'A report contains the answer, the question at that time, an optional short note and where in the lesson it happened. Only Rise Path administrators read it.',
        'The text of a report is deleted after 90 days. Counts of reports and stopped messages are kept for one year.',
        'When a message is stopped, only the kind and the count are recorded, not what was written.',
        'Automatic alerts to the operators never contain what a learner wrote.',
      ] as Para[],
    },
    compliance: {
      title: 'Laws and guidelines',
      items: [
        {
          text: 'We handle personal information under Japan’s Act on the Protection of Personal Information. The Personal Information Protection Commission says that, generally, consent from a legal representative is needed for children aged about 12 to 15 or younger (Q&A 1-62). Rise Path asks a guardian’s consent for every learner under 18 before AI is used.',
          link: { href: LINKS.ppc, label: 'PPC Q&A 1-62 (Japanese)' },
        },
        {
          text: 'We follow Anthropic’s guidelines for organizations serving minors and its Usage Policy: age checks, content filtering, monitoring and reporting, guidance for children and guardians, and telling users they are talking with AI.',
          link: { href: LINKS.minors, label: 'Anthropic: Guidelines for Organizations Serving Minors' },
          link2: { href: LINKS.aup, label: 'Anthropic Usage Policy' },
        },
        { text: 'AI answers are shown with a note that AI wrote them.' },
        { text: 'Our privacy policy and terms of use are being prepared. We will link them from this page once they are published.', when: 'legalPagesOff' },
        {
          text: 'Our privacy policy and terms of use are on these pages (in Japanese; the Japanese text is official).',
          when: 'legalPagesOn',
          pages: [{ to: '/privacy', label: 'Privacy Policy' }, { to: '/terms', label: 'Terms of Use' }],
        },
        { text: 'To delete your account, open Settings → Delete account.' },
        { text: 'If you have questions about this page, please ask the staff at the site where you use Rise Path.' },
      ],
    },
  },
  jp: {
    skip: '本文へ移動',
    language: '言語',
    home: 'Rise Path のトップへ',
    eyebrow: '2026年10月22日 更新',
    title: 'AI の安全について',
    description: 'AI 機能のしくみ、子どもを守るためのしくみ、保護者の方ができることを説明します。',
    toc: 'このページの内容',
    newTab: '（新しいタブで開きます）',
    setup: 'AI の利用設定を開く',
    backHome: 'トップページへ戻る',
    kids: {
      title: 'こどものみなさんへ',
      items: [
        'AI は人ではありません。コンピューターのプログラムです。',
        'AI の答えは、まちがえることがあります。へんだなと思ったら、先生や家の人に聞いてみてください。',
        '名前、住所、電話番号、学校の名前、写真など、自分やほかの人のことがわかることは、AI に書かないでください。',
        'AI に送れない内容は、とちゅうで止まります。止まっても、あなたが悪いのではありません。',
        'へんな答えや、いやな気持ちになる答えがあったら、答えの下の「報告」ボタンをおしてください。スタッフが見ます。',
        'つらいこと、こわいことがあったら、ひとりでかかえないでください。家の人や先生、下の窓口に話してください。',
        '18歳未満の人が AI を使うには、保護者の人の同意が必要です。',
      ] as Para[],
    },
    guardians: {
      title: '保護者の方へ',
      featuresTitle: 'AI 機能について',
      featuresItems: [
        'AI 先生：読んでいるレッスンについて、質問に答えます。',
        '作文フィードバック：書いた文章に、感想と直し方を返します。',
        '診断の解説：学び方の診断の結果を、文章で説明します。',
        'コースづくり：学びたいことから、学習コースの案をつくります。',
      ] as Para[],
      featuresNote:
        'AI 機能には、Anthropic 社の AI「Claude」を使っています。AI がつくった答えには、そのことを画面に表示します。AI の答えはまちがえることがあるので、大事なことは確かめるよう、お子さまにお伝えください。',
      ageTitle: '年齢と同意',
      age: [
        'AI を使う前に、生まれた年と月を登録していただきます（日にちは聞きません）。',
        '18歳未満の方は、保護者の方の同意が記録されるまで AI 機能を使えません。同意は、お子さまの端末で保護者の方がするか、紙の同意書をスタッフが記録します。',
        'AI を使わない学習は、同意がなくても使えます。',
      ] as Para[],
      dataTitle: '送られるデータ',
      data: [
        'AI 機能に入力した文章（質問や作文など）と、関係するレッスンの文章を、Anthropic 社（アメリカ）に送り、答えをつくります。18歳未満の方は、答えを確かめるためにも送ります。',
        '名前やメールアドレスは送りません。利用者を区別するため、アカウントからつくった、元に戻せない記号だけを送ります。',
        'Anthropic 社の商用利用規約により、送った内容は AI の学習（トレーニング）には使われません。',
      ] as Para[],
      protectTitle: 'お子さまを守るしくみ',
      protect: [
        '18歳未満の方には、AI に子どもの安全のための指示を加えます。',
        '18歳未満の方の入力と AI の答えは、表示する前に確かめます。ふさわしくない内容は止めます。確かめられないときは、答えを表示しません。',
        'つらい気持ちが書かれたときは、相談できる窓口を表示します。',
        '止められる入力が1日に何度も続いたときは、日本時間の夜0時まで AI をお休みにします。',
        '共有の端末では、ログアウトすると、そのブラウザに残る AI の答え（AI 先生の答えから作ったカード、診断の結果、下書きなど）を消します。',
      ] as Para[],
      revokeTitle: '同意のやめ方',
      revoke:
        '「設定」→「AI の利用設定」から、いつでも同意をやめられます。スタッフに伝えていただいても止められます。やめると AI はすぐに止まり、AI を使わない学習は続けられます。',
      version: (v: string) => `いまの同意文の版：${v}`,
    },
    support: { title: '相談できる窓口' },
    reports: {
      title: '報告のしくみ',
      items: [
        'AI の答えの下にある「報告」ボタンから、理由（あぶない・まちがい・年れいに合わない・その他）を選んで送れます。',
        '報告には、AI の答え、そのときの質問、ひとことメモ（なくてもかまいません）、レッスンの場所が入ります。読むのは Rise Path の管理者だけです。',
        '報告の文章は、90日たつと消します。報告や止めた入力の件数は、1年間保管します。',
        '入力が止められたときは、種類と回数だけを記録し、書いた文章は残しません。',
        '運営者への自動のお知らせには、学習者が書いた文章を入れません。',
      ] as Para[],
    },
    compliance: {
      title: '法令と指針について',
      items: [
        {
          text: '個人情報保護法にしたがって、個人情報を扱います。個人情報保護委員会は、一般に12歳から15歳までの年齢以下の子どもについて、法定代理人などの同意が必要としています（Q&A 1-62）。Rise Path は、18歳未満のすべての方について、AI を使う前に保護者の方の同意をいただきます。',
          link: { href: LINKS.ppc, label: '個人情報保護委員会 Q&A 1-62' },
        },
        {
          text: 'Anthropic 社の「未成年者にサービスを提供する組織向けのガイドライン」と利用ポリシーにそって、年齢の確認、内容のフィルター、見守りと報告、子どもと保護者への案内、AI であることの表示を行っています。',
          link: { href: LINKS.minors, label: 'Anthropic: Guidelines for Organizations Serving Minors（英語）' },
          link2: { href: LINKS.aup, label: 'Anthropic 利用ポリシー（英語）' },
        },
        { text: 'AI がつくった答えには、AI がつくったことを表示します。' },
        { text: 'プライバシーポリシーと利用規約は、いま準備しています。公開したら、このページからリンクします。', when: 'legalPagesOff' },
        {
          text: 'プライバシーポリシーと利用規約は、次のページで読めます。',
          when: 'legalPagesOn',
          pages: [{ to: '/privacy', label: 'プライバシーポリシー' }, { to: '/terms', label: '利用規約' }],
        },
        { text: 'アカウントを削除するときは、設定の「アカウントを削除する」を開いてください。' },
        { text: 'このページについてのご質問は、ご利用の拠点のスタッフにお伝えください。' },
      ],
    },
  },
} as const;

type ComplianceItem = {
  text: string;
  link?: { href: string; label: string };
  link2?: { href: string; label: string };
  /** Phase 4: in-app pages (the legal texts). */
  pages?: readonly { to: string; label: string }[];
  /** Phase 4: shown only while the legal pages are off / on (VITE_FEATURE_LEGAL_PAGES), so every line stays true. */
  when?: 'legalPagesOff' | 'legalPagesOn';
};

const shownNow = (item: ComplianceItem) => !item.when || (item.when === 'legalPagesOn') === features.legalPages;

const sectionClasses = 'scroll-mt-6 rounded-card border border-line bg-surface p-5 shadow-1 sm:p-6';

const SectionTitle: React.FC<{ id: string; icon: React.ElementType; children: React.ReactNode }> = ({ id, icon: Icon, children }) => (
  <h2 id={id} className="flex items-center gap-2 text-h2 text-fg">
    <Icon size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
    {children}
  </h2>
);

const Bullets: React.FC<{ items: readonly string[]; large?: boolean }> = ({ items, large }) => (
  <ul className={`mt-3 list-disc space-y-2 pl-5 marker:text-fg-3 ${large ? 'text-body-lg text-fg' : 'text-body text-fg-2'}`}>
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

const External: React.FC<{ href: string; label: string; newTab: string }> = ({ href, label, newTab }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-text underline underline-offset-4">
    {label}
    <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
    <span className="sr-only">{newTab}</span>
  </a>
);

const AiSafetyGuideView: React.FC = () => {
  const { language, selectedLanguage, setLanguage } = useLanguage();
  const { isLoggedIn } = useAuth();
  const t = copy[language];
  const standalone = !isLoggedIn;
  const languages: SelectedLanguage[] = features.frLocale ? ['en', 'jp', 'fr'] : ['en', 'jp'];

  const toc = [
    { id: 'for-children', label: t.kids.title },
    { id: 'for-guardians', label: t.guardians.title },
    { id: 'support', label: t.support.title },
    { id: 'reports', label: t.reports.title },
    { id: 'compliance', label: t.compliance.title },
  ];

  const body = (
    <div className="mx-auto max-w-read px-4 pb-20 pt-8 sm:px-6">
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.description}
        titleId="ai-safety-title"
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {standalone ? (
          <ButtonLink to="/" variant="secondary" size="sm">
            {t.backHome}
          </ButtonLink>
        ) : (
          <ButtonLink to={AI_ACCESS_SETUP_PATH} variant="primary" size="sm">
            {t.setup}
          </ButtonLink>
        )}
      </div>

      <nav aria-label={t.toc} className="mt-6 rounded-card border border-line bg-sunken p-4">
        <p className="text-small font-semibold text-fg-2">{t.toc}</p>
        <ol className="mt-2 grid gap-1 text-body sm:grid-cols-2">
          {toc.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="rounded-chip text-primary-text underline-offset-4 hover:underline">
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-6 space-y-6">
        <section aria-labelledby="for-children" className={sectionClasses}>
          <SectionTitle id="for-children" icon={Smile}>
            {t.kids.title}
          </SectionTitle>
          <Bullets items={t.kids.items} large />
        </section>

        <section aria-labelledby="for-guardians" className={sectionClasses}>
          <SectionTitle id="for-guardians" icon={ShieldCheck}>
            {t.guardians.title}
          </SectionTitle>
          <h3 className="mt-4 flex items-center gap-2 text-h3 text-fg">
            <Bot size={18} aria-hidden="true" className="shrink-0 text-fg-2" />
            {t.guardians.featuresTitle}
          </h3>
          <Bullets items={t.guardians.featuresItems} />
          <p className="mt-3 text-body text-fg">{t.guardians.featuresNote}</p>

          <h3 className="mt-6 text-h3 text-fg">{t.guardians.ageTitle}</h3>
          <Bullets items={t.guardians.age} />

          <h3 className="mt-6 text-h3 text-fg">{t.guardians.dataTitle}</h3>
          <Bullets items={t.guardians.data} />

          <h3 className="mt-6 text-h3 text-fg">{t.guardians.protectTitle}</h3>
          <Bullets items={t.guardians.protect} />

          <h3 className="mt-6 text-h3 text-fg">{t.guardians.revokeTitle}</h3>
          <p className="mt-3 text-body text-fg-2">{t.guardians.revoke}</p>
          <p className="mt-3 text-small text-fg-3">{t.guardians.version(CONSENT_POLICY_VERSION)}</p>
        </section>

        <div id="support" className="scroll-mt-6">
          <SupportLines />
        </div>

        <section aria-labelledby="reports" className={sectionClasses}>
          <SectionTitle id="reports" icon={Flag}>
            {t.reports.title}
          </SectionTitle>
          <Bullets items={t.reports.items} />
        </section>

        <section aria-labelledby="compliance" className={sectionClasses}>
          <SectionTitle id="compliance" icon={Scale}>
            {t.compliance.title}
          </SectionTitle>
          <ul className="mt-3 space-y-3 text-body text-fg-2">
            {(t.compliance.items as readonly ComplianceItem[]).filter(shownNow).map((item) => (
              <li key={item.text} className="border-l-2 border-line pl-3">
                <p>{item.text}</p>
                {item.pages ? (
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-small">
                    {item.pages.map((page) => (
                      <Link key={page.to} to={page.to} className="rounded-chip font-medium text-primary-text underline underline-offset-4">
                        {page.label}
                      </Link>
                    ))}
                  </p>
                ) : null}
                {item.link || item.link2 ? (
                  <p className="mt-1 flex flex-col gap-1 text-small">
                    {item.link ? <External {...item.link} newTab={t.newTab} /> : null}
                    {item.link2 ? <External {...item.link2} newTab={t.newTab} /> : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );

  if (!standalone) return body;

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-fg">
      <a
        href="#ai-safety-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-3"
      >
        {t.skip}
      </a>
      <header className="mx-auto flex max-w-wide items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
        <Link to="/" aria-label={t.home} className="flex items-center gap-2.5 rounded-control text-h3 font-bold text-fg">
          <BrandMark size={30} />
          <span>Rise Path</span>
        </Link>
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
      <main id="ai-safety-main" tabIndex={-1} className="focus:outline-none">
        {body}
      </main>
    </div>
  );
};

export default AiSafetyGuideView;
