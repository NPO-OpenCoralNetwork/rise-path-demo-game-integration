import React from 'react';
import { HeartHandshake, MessageCircle, Phone } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Places a child can call or chat with, shown when a message touches on self-harm or distress,
 * on the setup page and on /ai-safety.
 *
 * Every number, hour and fee below was checked on an official page on 2026-10-22 (the source note
 * lists them). Do not add a line or change a detail without checking its official page again.
 * 189: the こども家庭庁 page gives the number and says it connects to the nearest 児童相談所; the hours
 * (24時間365日) are from the 文部科学省 list of SOS lines. Neither page states a fee, so none is shown.
 *
 * `compact`: the short list for an inline notice (tutor panel, error card); sources fold away.
 */

type Line = {
  key: string;
  name: string;
  /** tel: value (digits only). Absent for chat. */
  tel?: string;
  /** Number as written. */
  number?: string;
  /** Chat link. */
  href?: string;
  hours: string;
  /** Extra detail, shown only in the full list. */
  detail?: string;
};

type Source = { label: string; href: string };

const SOURCES: Source[] = [
  { label: '文部科学省 24時間子供SOSダイヤル', href: 'https://www.mext.go.jp/a_menu/shotou/seitoshidou/06112210.htm' },
  { label: 'チャイルドライン', href: 'https://childline.or.jp/tel/' },
  { label: '法務省 こどもの人権110番', href: 'https://www.moj.go.jp/JINKEN/jinken112.html' },
  { label: 'こども家庭庁 189', href: 'https://kodomoshien.cfa.go.jp/no-gyakutai/189/' },
  { label: '文部科学省 SOSの相談窓口（189 の受付時間）', href: 'https://www.mext.go.jp/a_menu/shotou/seitoshidou/06112211.html' },
  { label: 'あなたのいばしょ', href: 'https://talkme.jp/' },
];

type Copy = {
  title: string;
  lead: string;
  call: string;
  chat: string;
  newTab: string;
  emergency: string;
  sources: string;
  lines: Line[];
};

const copy: Record<'en' | 'jp', Copy> = {
  en: {
    title: 'You can talk to someone',
    lead: 'If something is hard or scary, you do not have to keep it to yourself. These places listen.',
    call: 'Call',
    chat: 'Open chat',
    newTab: '(opens in a new tab)',
    emergency: 'If your life or someone else’s is in danger right now, call 110 (police) or 119 (fire and ambulance).',
    sources: 'Sources (checked on 22 Oct 2026)',
    lines: [
      { key: 'sos', name: '24-hour Child SOS Dial (MEXT)', tel: '0120078310', number: '0120-0-78310', hours: '24 hours · free' },
      {
        key: 'childline',
        name: 'Childline',
        tel: '0120997777',
        number: '0120-99-7777',
        hours: 'Every day 4–9 pm · free · up to age 18',
        detail: 'Closed 29 Dec – 3 Jan.',
      },
      {
        key: 'jinken',
        name: 'Children’s Human Rights 110 (Ministry of Justice)',
        tel: '0120007110',
        number: '0120-007-110',
        hours: 'Weekdays 8:30 am – 5:15 pm · free',
      },
      {
        key: '189',
        name: 'Child abuse hotline (child guidance centers)',
        tel: '189',
        number: '189',
        hours: '24 hours, every day',
        detail: 'If you are being hurt at home, or think another child is.',
      },
      { key: 'ibasho', name: 'Anata no Ibasho (chat)', href: 'https://talkme.jp/', hours: '24 hours, every day' },
    ],
  },
  jp: {
    title: '話を聞いてくれる場所があります',
    lead: 'つらいこと、こわいことがあったら、ひとりでかかえなくて大丈夫です。話を聞いてくれる人がいます。',
    call: '電話する',
    chat: 'チャットを開く',
    newTab: '（新しいタブで開きます）',
    emergency: '命があぶないときは、すぐに 110（警察）か 119（救急・消防）に電話してください。',
    sources: '情報のもと（2026年10月22日に確認）',
    lines: [
      { key: 'sos', name: '24時間子供SOSダイヤル', tel: '0120078310', number: '0120-0-78310', hours: '24時間・無料' },
      {
        key: 'childline',
        name: 'チャイルドライン',
        tel: '0120997777',
        number: '0120-99-7777',
        hours: '毎日 16時〜21時・無料・18歳まで',
        detail: '12月29日〜1月3日はお休みです。',
      },
      { key: 'jinken', name: 'こどもの人権110番', tel: '0120007110', number: '0120-007-110', hours: '平日 8時30分〜17時15分・無料' },
      {
        key: '189',
        name: '児童相談所虐待対応ダイヤル',
        tel: '189',
        number: '189',
        hours: '24時間365日',
        detail: '家でたたかれる、ごはんがもらえないなど。ほかの子のことでも相談できます。',
      },
      { key: 'ibasho', name: 'あなたのいばしょ（チャット）', href: 'https://talkme.jp/', hours: '24時間365日' },
    ],
  },
};

export interface SupportLinesProps {
  compact?: boolean;
  /** Heading level of the title (default 2; 3 inside a section). */
  headingLevel?: 2 | 3;
  /** Overrides the app language (a screen with its own language switch, e.g. the assessment). */
  language?: 'en' | 'jp';
  className?: string;
}

export const SupportLines: React.FC<SupportLinesProps> = ({ compact = false, headingLevel = 2, language: override, className = '' }) => {
  const { language: appLanguage } = useLanguage();
  const t = copy[override ?? appLanguage];
  const Heading = (compact ? 'p' : `h${headingLevel}`) as 'p' | 'h2' | 'h3';
  const titleId = React.useId();

  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-card border border-line bg-surface ${compact ? 'p-4' : 'p-5'} ${className}`}
    >
      <Heading id={titleId} className={`flex items-center gap-2 font-semibold text-fg ${compact ? 'text-body' : 'text-h3'}`}>
        <HeartHandshake size={compact ? 18 : 20} aria-hidden="true" className="shrink-0 text-primary-text" />
        {t.title}
      </Heading>
      {!compact && <p className="mt-1 text-body text-fg-2">{t.lead}</p>}

      <ul className={`${compact ? 'mt-2 space-y-1.5' : 'mt-4 space-y-3'}`}>
        {t.lines.map((line) => (
          <li
            key={line.key}
            className={compact ? 'flex flex-wrap items-baseline gap-x-2 text-small' : 'rounded-control bg-sunken px-4 py-3'}
          >
            <span className={`font-semibold text-fg ${compact ? '' : 'block text-body'}`}>{line.name}</span>
            {line.tel ? (
              <a
                href={`tel:${line.tel}`}
                className={`inline-flex items-center gap-1 font-semibold text-primary-text underline underline-offset-4 tabular ${compact ? '' : 'mt-1 text-h3'}`}
              >
                <Phone size={compact ? 14 : 16} aria-hidden="true" />
                <span className="sr-only">{t.call}: </span>
                {line.number}
              </a>
            ) : line.href ? (
              <a
                href={line.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 font-semibold text-primary-text underline underline-offset-4 ${compact ? '' : 'mt-1 text-body'}`}
              >
                <MessageCircle size={compact ? 14 : 16} aria-hidden="true" />
                {t.chat}
                <span className="sr-only">{t.newTab}</span>
              </a>
            ) : null}
            <span className={`text-fg-2 ${compact ? 'text-small' : 'block text-small'}`}>{line.hours}</span>
            {!compact && line.detail ? (
              <span className="block text-small text-fg-3">{line.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>

      <p className={`${compact ? 'mt-2 text-small' : 'mt-4 text-body'} font-semibold text-fg`}>{t.emergency}</p>

      <details className="mt-3 text-caption text-fg-3">
        <summary className="cursor-pointer rounded-chip">{t.sources}</summary>
        <ul className="mt-1 space-y-0.5">
          {SOURCES.map((source) => (
            <li key={source.href}>
              <a href={source.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">
                {source.label}: {source.href}
              </a>
              <span className="sr-only">{t.newTab}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
};

export default SupportLines;
